import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Client } from "pg";
import type { output as ZodOutput } from "zod";
import {
  assertReadOnly,
  cellText,
  classifyEngine,
  classifyRole,
  classifySql,
  postgresEndpoint,
  quoteIdent,
  redactEndpoint,
  selectStar,
  sqlLiteral,
} from "./warehouse.logic";
import {
  browseCatalog,
  connectionIdOf,
  dsnRole,
  loadSnapshot,
  readSql,
  runQuery,
  type BrowseNode,
  type BrowseResult,
  type ConnectionFileType,
  type DataConnection,
  type Engine,
  type QueryResult,
  type Snapshot,
  type SqlFile,
  type WorkspaceRef,
} from "./warehouse.shared";
import { walkConnectionFiles, type ConnectionFileRecord } from "./connection.files";

type AgentHost = {
  workspaces?: {
    list(options?: { page?: { limit: number; cursor?: string } }): Promise<{
      entries?: unknown[];
      pageInfo?: { nextCursor?: string };
    }>;
  };
};

type Secret =
  | {
      engine: "postgres";
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    }
  | { engine: "postgres"; connectionString: string }
  | { engine: "sqlite"; file: string };

type Catalog = {
  host: string;
  connections: DataConnection[];
  sqls: SqlFile[];
  secrets: Map<string, Secret>;
};

const STATE_DIR = join(homedir(), ".paseo/data-warehouse");
const LOCAL_SQLITE = join(STATE_DIR, "local.sqlite");
const ASMP_URL = "http://127.0.0.1:7700/services";
const SQLITE_BIN = existsSync("/usr/bin/sqlite3") ? "/usr/bin/sqlite3" : "sqlite3";
const DSN_CACHE_MS = 20_000;
const URI_KEYS = ["EIDOS_DB_DSN", "DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL", "POSTGRESQL_URL"];
const ENV_FILES = [".env.local", ".env"];
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".tox",
  ".venv",
  ".mypy_cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "Pods",
  "__pycache__",
]);
const MAX_SQL = 80;
const MAX_DEPTH = 5;
const MAX_PREVIEW = 280;
const MAX_READ = 48_000;
const DEFAULT_LIMIT = 100;
const CATALOG_LIMIT = 400;

let dsnCache: { at: number; catalog: Catalog } | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hidePgError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Query failed";
  return new Error(message.replace(/password=[^ \t]+/gi, "password=***").replace(/:[^:@/]+@/g, "@"));
}

async function runPaseo(args: string[]): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn("paseo", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `paseo ${args.join(" ")} failed (${code ?? "?"})`));
    });
  });
}

async function listJson(args: string[]): Promise<unknown> {
  return JSON.parse(await runPaseo(args)) as unknown;
}

function asWorkspace(entry: unknown): WorkspaceRef | null {
  const rec = asRecord(entry);
  if (!rec) {
    return null;
  }
  const id = str(rec.id) ?? str(rec.workspaceId);
  const cwd = str(rec.cwd) ?? str(rec.directory) ?? str(rec.workspaceDirectory);
  if (!id || !cwd) {
    return null;
  }
  return {
    id,
    title: str(rec.title) || str(rec.name) || id.slice(0, 8),
    cwd,
  };
}

async function listWorkspacesFromSdk(paseo: AgentHost): Promise<WorkspaceRef[]> {
  if (!paseo.workspaces?.list) {
    return [];
  }
  try {
    const items: WorkspaceRef[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 12; i += 1) {
      const page = await paseo.workspaces.list({
        page: cursor ? { limit: 100, cursor } : { limit: 100 },
      });
      for (const entry of page.entries ?? []) {
        const item = asWorkspace(entry);
        if (item) {
          items.push(item);
        }
      }
      const next = page.pageInfo?.nextCursor;
      if (!next) {
        break;
      }
      cursor = next;
    }
    return items;
  } catch {
    return [];
  }
}

async function listWorkspaces(paseo: AgentHost): Promise<WorkspaceRef[]> {
  const [sdk, cli] = await Promise.all([
    listWorkspacesFromSdk(paseo),
    listJson(["workspace", "ls", "--json"])
      .then((raw) => (Array.isArray(raw) ? raw : []).map(asWorkspace).filter((item): item is WorkspaceRef => item !== null))
      .catch(() => [] as WorkspaceRef[]),
  ]);
  const byId = new Map<string, WorkspaceRef>();
  for (const workspace of [...cli, ...sdk]) {
    byId.set(workspace.id, workspace);
  }
  return [...byId.values()];
}

function uniqueWorkspaces(workspaces: WorkspaceRef[]): WorkspaceRef[] {
  const byCwd = new Map<string, WorkspaceRef>();
  for (const workspace of workspaces) {
    const key = resolve(workspace.cwd);
    if (!byCwd.has(key)) {
      byCwd.set(key, { ...workspace, cwd: key });
    }
  }
  return [...byCwd.values()];
}

function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const cut = trimmed.indexOf("=");
      const key = trimmed.slice(0, cut).trim();
      let value = trimmed.slice(cut + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    return env;
  }
  return env;
}

function addConnection(catalog: Catalog, connection: DataConnection, secret: Secret | null): void {
  const existing = catalog.connections.find((item) => item.id === connection.id);
  if (existing) {
    if (connection.fileType === "prim.data-connection" && existing.fileType !== "prim.data-connection") {
      existing.fileType = connection.fileType;
      if (connection.path) {
        existing.path = connection.path;
      }
    }
    if (secret && connection.canQuery && !catalog.secrets.has(connection.id)) {
      catalog.secrets.set(connection.id, secret);
    }
    return;
  }
  catalog.connections.push(connection);
  if (secret && connection.canQuery) {
    catalog.secrets.set(connection.id, secret);
  }
}

function uriDsn(
  id: string,
  name: string,
  uri: string,
  source: DataConnection["source"],
  workspace?: WorkspaceRef,
  fileType: ConnectionFileType = "dsn",
  path?: string,
): { connection: DataConnection; secret: Secret | null } {
  const engine = classifyEngine(name, uri);
  const queryable = engine === "postgres" || (engine === "sqlite" && uri.startsWith("/"));
  return {
    connection: {
      id,
      name,
      engine,
      role: classifyRole(name, uri, [name]),
      source,
      fileType,
      endpoint: redactEndpoint(uri),
      status: queryable ? "ready" : "needs secret",
      canQuery: queryable,
      hint: queryable ? "Pick this Data Connection and run SQL." : "No queryable secret on the daemon.",
      path,
      workspaceId: workspace?.id,
      workspaceTitle: workspace?.title,
    },
    secret: engine === "postgres" ? { engine: "postgres", connectionString: uri } : engine === "sqlite" ? { engine: "sqlite", file: uri } : null,
  };
}

function splitPostgres(
  id: string,
  name: string,
  env: Record<string, string>,
  source: DataConnection["source"],
  workspace?: WorkspaceRef,
  fileType: ConnectionFileType = "dsn",
  path?: string,
): { connection: DataConnection; secret: Secret | null } | null {
  const host = env.DBT_PG_HOST || env.PGHOST || env.POSTGRES_HOST;
  const database = env.DBT_PG_DATABASE || env.PGDATABASE || env.POSTGRES_DB;
  const user = env.DBT_PG_USER || env.PGUSER || env.POSTGRES_USER || "";
  const password = env.DBT_PG_PASSWORD || env.PGPASSWORD || env.POSTGRES_PASSWORD || "";
  const port = Number(env.DBT_PG_PORT || env.PGPORT || env.POSTGRES_PORT || "5432");
  if (!host || !database) {
    return null;
  }
  const endpoint = postgresEndpoint(host, String(port), database, user);
  return {
    connection: {
      id,
      name,
      engine: "postgres",
      role: classifyRole(name, endpoint, Object.keys(env)),
      source,
      fileType,
      endpoint,
      status: "ready",
      canQuery: true,
      hint: "Pick this Data Connection and run SQL.",
      path,
      workspaceId: workspace?.id,
      workspaceTitle: workspace?.title,
    },
    secret: { engine: "postgres", host, port, user, password, database },
  };
}

function shouldScanSql(cwd: string): boolean {
  const root = resolve(cwd);
  const home = resolve(homedir());
  if (root === home || root === "/" || root === "/tmp" || root === "/private/tmp") {
    return false;
  }
  return root.split(sep).filter(Boolean).length >= 4;
}

function ensureLocalSqlite(): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const created = spawnSync(
    SQLITE_BIN,
    [
      LOCAL_SQLITE,
      "create table if not exists catalog (id text primary key, name text not null); insert or ignore into catalog values ('local','This Paseo');",
    ],
    { encoding: "utf8" },
  );
  if (created.status !== 0 && !existsSync(LOCAL_SQLITE)) {
    throw new Error(created.stderr.trim() || `Could not create ${LOCAL_SQLITE}`);
  }
}

function applyFileRecord(
  catalog: Catalog,
  record: ConnectionFileRecord,
  source: DataConnection["source"],
  workspace?: WorkspaceRef,
): void {
  if (record.sqlite) {
    sqliteFileDsn(
      catalog,
      record.id,
      record.name,
      record.sqlite,
      workspace,
      source,
      record.fileType,
      record.path,
    );
    return;
  }
  if (record.envFile && existsSync(record.envFile)) {
    const env = readEnvFile(record.envFile);
    const split = splitPostgres(record.id, record.name, env, source, workspace, record.fileType, record.path);
    if (split) {
      addConnection(
        catalog,
        {
          ...split.connection,
          role: dsnRole.safeParse(record.role).success ? dsnRole.parse(record.role) : split.connection.role,
        },
        split.secret,
      );
      return;
    }
    for (const key of URI_KEYS) {
      const value = env[key];
      if (value && !value.startsWith("http")) {
        const built = uriDsn(record.id, record.name, value, source, workspace, record.fileType, record.path);
        addConnection(catalog, built.connection, built.secret);
        return;
      }
    }
  }
  addConnection(
    catalog,
    {
      id: record.id,
      name: record.name,
      engine: record.engine === "sqlite" || record.engine === "mysql" ? record.engine : "postgres",
      role: dsnRole.safeParse(record.role).success ? dsnRole.parse(record.role) : "unknown",
      source,
      fileType: record.fileType,
      endpoint: record.envFile || record.path,
      status: "needs secret",
      canQuery: false,
      hint: "This Data Connection has no secret on the daemon.",
      path: record.path,
      workspaceId: workspace?.id,
      workspaceTitle: workspace?.title,
    },
    null,
  );
}

function loadConnectionFiles(catalog: Catalog, roots: Array<{ cwd: string; source: DataConnection["source"]; workspace?: WorkspaceRef }>): void {
  for (const root of roots) {
    if (!existsSync(root.cwd)) {
      continue;
    }
    for (const record of walkConnectionFiles(root.cwd)) {
      applyFileRecord(catalog, record, root.source, root.workspace);
    }
  }
}

function processEnvDsns(catalog: Catalog): void {
  for (const key of URI_KEYS) {
    const value = process.env[key];
    if (!value) {
      continue;
    }
    const built = uriDsn(`env:${key}`, key, value, "env");
    addConnection(catalog, built.connection, built.secret);
  }
  const split = splitPostgres("env:pg", "PG / DBT_PG", process.env as Record<string, string>, "env");
  if (split) {
    addConnection(catalog, split.connection, split.secret);
  }
}

function workspaceEnvDsns(catalog: Catalog, workspace: WorkspaceRef): void {
  for (const file of ENV_FILES) {
    const path = join(workspace.cwd, file);
    if (!existsSync(path)) {
      continue;
    }
    const env = readEnvFile(path);
    const split = splitPostgres(
      `envfile:${workspace.id}:pg`,
      `${workspace.title} warehouse`,
      env,
      "envfile",
      workspace,
    );
    if (split) {
      addConnection(catalog, split.connection, split.secret);
    }
    for (const key of URI_KEYS) {
      const value = env[key];
      if (!value || value.startsWith("http")) {
        continue;
      }
      const built = uriDsn(`envfile:${workspace.id}:${key}`, `${workspace.title} ${key}`, value, "envfile", workspace);
      addConnection(catalog, built.connection, built.secret);
    }
  }
}

function sqliteFileDsn(
  catalog: Catalog,
  id: string,
  name: string,
  file: string,
  workspace?: WorkspaceRef,
  source: DataConnection["source"] = workspace ? "envfile" : "asmp",
  fileType: ConnectionFileType = "dsn",
  path?: string,
): void {
  if (!existsSync(file)) {
    addConnection(
      catalog,
      {
        id,
        name,
        engine: "sqlite",
        role: "local",
        source,
        fileType,
        endpoint: file,
        status: "missing",
        canQuery: false,
        hint: "SQLite file is not on this machine.",
        path,
        workspaceId: workspace?.id,
        workspaceTitle: workspace?.title,
      },
      null,
    );
    return;
  }
  addConnection(
    catalog,
    {
      id,
      name,
      engine: "sqlite",
      role: "local",
      source,
      fileType,
      endpoint: file,
      status: "ready",
      canQuery: true,
      hint: "Pick this Data Connection and run SQL.",
      path,
      workspaceId: workspace?.id,
      workspaceTitle: workspace?.title,
    },
    { engine: "sqlite", file },
  );
}

function previewText(path: string): string {
  try {
    return readFileSync(path, "utf8").slice(0, MAX_PREVIEW).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function walkSqls(root: string, rel: string, depth: number, sqls: SqlFile[], workspace: WorkspaceRef): void {
  if (sqls.length >= MAX_SQL || depth > MAX_DEPTH) {
    return;
  }
  const dir = rel ? join(root, rel) : root;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (sqls.length >= MAX_SQL) {
      return;
    }
    if (name.startsWith(".")) {
      continue;
    }
    const nextRel = rel ? `${rel}/${name}` : name;
    const full = join(root, nextRel);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) {
        walkSqls(root, nextRel, depth + 1, sqls, workspace);
      }
      continue;
    }
    if (!stat.isFile() || !name.endsWith(".sql")) {
      continue;
    }
    sqls.push({
      id: `${workspace.id}:${nextRel}`,
      name,
      path: full,
      kind: classifySql(nextRel),
      bytes: stat.size,
      preview: previewText(full),
      workspaceId: workspace.id,
      workspaceTitle: workspace.title,
    });
  }
}

function endpointFrom(service: Record<string, unknown>): { display: string; sqlite?: string } {
  const endpoints = Array.isArray(service.endpoints) ? service.endpoints : [];
  for (const entry of endpoints) {
    const rec = asRecord(entry);
    if (!rec) {
      continue;
    }
    const protocol = str(rec.protocol) ?? "tcp";
    const host = str(rec.host);
    const path = str(rec.path);
    const port = typeof rec.port === "number" ? rec.port : undefined;
    if (path && (path.endsWith(".sqlite") || path.endsWith(".sqlite3") || protocol === "file")) {
      return { display: path, sqlite: path.replace(/^~/, homedir()) };
    }
    if (host && port) {
      return { display: redactEndpoint(`${protocol}://${host}:${port}`) };
    }
    if (path) {
      return { display: redactEndpoint(path) };
    }
  }
  return { display: "" };
}

async function asmpDsns(catalog: Catalog): Promise<void> {
  try {
    const response = await fetch(ASMP_URL);
    if (!response.ok) {
      throw new Error(`ASMP ${response.status}`);
    }
    const raw = (await response.json()) as unknown;
    const rows = Array.isArray(raw) ? raw : [];
    for (const entry of rows) {
      const rec = asRecord(entry);
      if (!rec) {
        continue;
      }
      catalog.host = str(rec.host) || catalog.host;
      const name = str(rec.name) ?? "service";
      const provides = strings(asRecord(rec.capabilities)?.provides);
      const blob = `${name} ${provides.join(" ")}`.toLowerCase();
      const { display, sqlite } = endpointFrom(rec);
      if (sqlite) {
        sqliteFileDsn(catalog, `asmp:${name}`, name, sqlite);
        continue;
      }
      if (!blob.includes("sql") && !blob.includes("postgres") && !blob.includes("database.") && str(rec.section) !== "data") {
        continue;
      }
      if (blob.includes("explorer") || blob.includes("catalog") || blob.includes("data.contract")) {
        continue;
      }
      addConnection(
        catalog,
        {
          id: `asmp:${name}`,
          name,
          engine: classifyEngine(name, display),
          role: classifyRole(name, display, provides),
          source: "asmp",
          fileType: "dsn",
          endpoint: display,
          status: str(rec.status) ?? "registered",
          canQuery: false,
          hint: "Registered here, but this Paseo has no Data Connection secret for it.",
        },
        null,
      );
    }
  } catch (caught) {
    addConnection(
      catalog,
      {
        id: "asmp:unreachable",
        name: "ASMP registry",
        engine: "postgres",
        role: "unknown",
        source: "asmp",
        fileType: "dsn",
        endpoint: "http://127.0.0.1:7700",
        status: "down",
        canQuery: false,
        hint: caught instanceof Error ? caught.message : "Could not read ASMP",
      },
      null,
    );
  }
}

function markerSqlite(catalog: Catalog, workspace: WorkspaceRef): void {
  const fakabase = join(workspace.cwd, "data_packs", "out", "fakabase.sqlite");
  if (existsSync(fakabase)) {
    sqliteFileDsn(catalog, `sqlite:${workspace.id}:fakabase`, `${workspace.title} fakabase`, fakabase, workspace);
  }
}

async function buildDsns(
  paseo: AgentHost,
  workspaceId?: string,
): Promise<{ catalog: Catalog; selected?: WorkspaceRef }> {
  const catalog: Catalog = { host: "this Paseo", connections: [], sqls: [], secrets: new Map() };
  ensureLocalSqlite();
  sqliteFileDsn(catalog, "paseo:local", "This Paseo", LOCAL_SQLITE, undefined, "catalog");
  loadConnectionFiles(catalog, [{ cwd: STATE_DIR, source: "catalog" }]);
  processEnvDsns(catalog);
  await asmpDsns(catalog);
  const all = await listWorkspaces(paseo);
  const selected = workspaceId ? all.find((item) => item.id === workspaceId) : undefined;
  const scan = uniqueWorkspaces(selected ? [selected] : all).slice(0, selected ? 1 : 16);
  for (const workspace of scan) {
    loadConnectionFiles(catalog, [{ cwd: workspace.cwd, source: "workspace", workspace }]);
    workspaceEnvDsns(catalog, workspace);
    markerSqlite(catalog, workspace);
  }
  return { catalog, selected };
}

async function buildCatalog(paseo: AgentHost, workspaceId?: string): Promise<{ catalog: Catalog; selected?: WorkspaceRef }> {
  const { catalog, selected } = await buildDsns(paseo, workspaceId);
  dsnCache = { at: Date.now(), catalog };
  if (selected && shouldScanSql(selected.cwd)) {
    walkSqls(selected.cwd, "", 0, catalog.sqls, selected);
  }
  return { catalog, selected };
}

async function catalogForQuery(paseo: AgentHost): Promise<Catalog> {
  if (dsnCache && Date.now() - dsnCache.at < DSN_CACHE_MS) {
    return dsnCache.catalog;
  }
  const { catalog } = await buildDsns(paseo);
  dsnCache = { at: Date.now(), catalog };
  return catalog;
}

function swapPgDatabase(uri: string, database: string): string {
  const q = uri.indexOf("?");
  const base = q === -1 ? uri : uri.slice(0, q);
  const rest = q === -1 ? "" : uri.slice(q);
  const scheme = /^(postgres(?:ql)?:\/\/)/i.exec(base)?.[1] ?? "postgres://";
  const after = base.slice(scheme.length);
  const slash = after.indexOf("/");
  const head = slash === -1 ? after : after.slice(0, slash);
  return `${scheme}${head}/${database}${rest}`;
}

function withDatabase(secret: Secret, database?: string): Secret {
  if (!database || secret.engine !== "postgres") {
    return secret;
  }
  if ("connectionString" in secret) {
    return { engine: "postgres", connectionString: swapPgDatabase(secret.connectionString, database) };
  }
  return { ...secret, database };
}

function catalogItems(
  result: QueryResult,
  fallback: BrowseNode["kind"],
  engine: Engine,
  schema?: string,
): { items: BrowseNode[]; truncated: boolean } {
  const nameIdx = result.columns.indexOf("name");
  const kindIdx = result.columns.indexOf("kind");
  const detailIdx = result.columns.indexOf("detail");
  const typeIdx = result.columns.indexOf("type");
  const items: BrowseNode[] = [];
  for (const row of result.rows) {
    const name = (nameIdx >= 0 ? row[nameIdx] : row[0]) ?? "";
    if (!name) {
      continue;
    }
    const type = typeIdx >= 0 ? row[typeIdx] : null;
    const kindRaw = kindIdx >= 0 ? row[kindIdx] : type;
    const kind: BrowseNode["kind"] =
      kindRaw === "view" || kindRaw === "m" || kindRaw === "v"
        ? "view"
        : kindRaw === "column"
          ? "column"
          : kindRaw === "schema"
            ? "schema"
            : kindRaw === "database"
              ? "database"
              : fallback;
    const detail = (detailIdx >= 0 ? row[detailIdx] : typeIdx >= 0 && kindIdx >= 0 ? row[typeIdx] : null) ?? undefined;
    const sql =
      (kind === "table" || kind === "view") && schema
        ? selectStar(engine, schema, name)
        : undefined;
    items.push({ name, kind, detail: detail ?? undefined, sql });
    if (items.length >= CATALOG_LIMIT) {
      break;
    }
  }
  return { items, truncated: result.truncated || result.rows.length > items.length };
}

async function currentPostgresDatabase(secret: Extract<Secret, { engine: "postgres" }>): Promise<string> {
  const result = await queryPostgres(secret, "select current_database() as name", 1);
  return result.rows[0]?.[0] ?? "postgres";
}

async function browsePostgres(
  secret: Extract<Secret, { engine: "postgres" }>,
  engine: Engine,
  input: { database?: string; schema?: string; table?: string },
): Promise<BrowseResult> {
  const connected = withDatabase(secret, input.database);
  if (connected.engine !== "postgres") {
    throw new Error("Expected a postgres Data Connection.");
  }
  const database = input.database || (await currentPostgresDatabase(connected));
  if (input.table && input.schema) {
    const result = await queryPostgres(
      connected,
      `select column_name as name, coalesce(data_type, udt_name) as detail from information_schema.columns where table_schema = ${sqlLiteral(input.schema)} and table_name = ${sqlLiteral(input.table)} order by ordinal_position`,
      CATALOG_LIMIT,
    );
    const packed = catalogItems(result, "column", engine);
    return { engine, database, schema: input.schema, table: input.table, ...packed };
  }
  if (input.schema) {
    const result = await queryPostgres(
      connected,
      `select table_name as name, case when table_type = 'VIEW' then 'view' else 'table' end as kind from information_schema.tables where table_schema = ${sqlLiteral(input.schema)} and table_type in ('BASE TABLE','VIEW') order by 1`,
      CATALOG_LIMIT,
    );
    const packed = catalogItems(result, "table", engine, input.schema);
    return { engine, database, schema: input.schema, ...packed };
  }
  if (input.database) {
    const result = await queryPostgres(
      connected,
      "select nspname as name from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1",
      CATALOG_LIMIT,
    );
    const packed = catalogItems(result, "schema", engine);
    return { engine, database, ...packed };
  }
  const result = await queryPostgres(
    connected,
    "select datname as name from pg_database where datallowconn and not datistemplate order by 1",
    CATALOG_LIMIT,
  );
  const packed = catalogItems(result, "database", engine);
  return { engine, database, ...packed };
}

async function browseSqlite(
  file: string,
  engine: Engine,
  input: { database?: string; schema?: string; table?: string },
): Promise<BrowseResult> {
  const database = input.database || "main";
  if (input.table) {
    const result = await querySqlite(
      file,
      `pragma table_info(${quoteIdent("sqlite", input.table)})`,
      CATALOG_LIMIT,
    );
    const nameIdx = result.columns.indexOf("name");
    const typeIdx = result.columns.indexOf("type");
    const items: BrowseNode[] = result.rows.map((row) => ({
      name: (nameIdx >= 0 ? row[nameIdx] : row[1]) ?? "",
      kind: "column" as const,
      detail: (typeIdx >= 0 ? row[typeIdx] : null) ?? undefined,
    })).filter((item) => item.name);
    return {
      engine,
      database,
      schema: input.schema || "main",
      table: input.table,
      items,
      truncated: result.truncated,
    };
  }
  if (input.schema) {
    const result = await querySqlite(
      file,
      "select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name",
      CATALOG_LIMIT,
    );
    const packed = catalogItems(result, "table", engine, input.schema);
    return { engine, database, schema: input.schema, ...packed };
  }
  if (input.database) {
    return {
      engine,
      database,
      items: [{ name: "main", kind: "schema", detail: "sqlite" }],
      truncated: false,
    };
  }
  return {
    engine,
    database: "main",
    items: [{ name: "main", kind: "database", detail: "sqlite" }],
    truncated: false,
  };
}

async function queryPostgres(secret: Extract<Secret, { engine: "postgres" }>, sql: string, limit: number): Promise<QueryResult> {
  const started = Date.now();
  const client =
    "connectionString" in secret
      ? new Client({ connectionString: secret.connectionString, connectionTimeoutMillis: 5000 })
      : new Client({
          host: secret.host,
          port: secret.port,
          user: secret.user,
          password: secret.password,
          database: secret.database,
          connectionTimeoutMillis: 5000,
        });
  await client.connect();
  try {
    await client.query("set statement_timeout = 8000");
    const result = await client.query(sql);
    const columns = result.fields.map((field) => field.name);
    const truncated = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).map((row) => columns.map((column) => cellText(row[column])));
    return {
      columns,
      rows,
      rowCount: result.rowCount ?? rows.length,
      truncated,
      ms: Date.now() - started,
    };
  } finally {
    await client.end();
  }
}

async function querySqlite(file: string, sql: string, limit: number): Promise<QueryResult> {
  const started = Date.now();
  const raw = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(SQLITE_BIN, ["-readonly", "-json", file, sql], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `sqlite3 failed (${code ?? "?"})`));
    });
  });
  const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : [];
  const records = Array.isArray(parsed) ? parsed : [];
  const columns = records.length ? Object.keys(asRecord(records[0]) ?? {}) : [];
  const truncated = records.length > limit;
  const rows = records.slice(0, limit).map((entry) => {
    const rec = asRecord(entry) ?? {};
    return columns.map((column) => cellText(rec[column]));
  });
  return {
    columns,
    rows,
    rowCount: records.length,
    truncated,
    ms: Date.now() - started,
  };
}

export async function loadSnapshotHandler(
  input: ZodOutput<typeof loadSnapshot.input>,
  { paseo }: { paseo: AgentHost },
): Promise<Snapshot> {
  const { catalog, selected } = await buildCatalog(paseo, input.workspaceId);
  return {
    host: catalog.host,
    connections: catalog.connections,
    sqls: catalog.sqls,
    workspace: selected,
  };
}

function isInside(root: string, target: string): boolean {
  const base = resolve(root) + sep;
  const full = resolve(target);
  return full === resolve(root) || full.startsWith(base);
}

export async function readSqlHandler(
  input: ZodOutput<typeof readSql.input>,
  { paseo }: { paseo: AgentHost },
): Promise<{ path: string; text: string; truncated: boolean }> {
  const requested = resolve(input.path);
  const workspaces = await listWorkspaces(paseo);
  const allowed = workspaces.some((workspace) => isInside(workspace.cwd, requested));
  if (!allowed || !requested.endsWith(".sql")) {
    throw new Error("That SQL is outside a Paseo workspace.");
  }
  const raw = readFileSync(requested, "utf8");
  const truncated = raw.length > MAX_READ;
  return {
    path: requested,
    text: truncated ? raw.slice(0, MAX_READ) : raw,
    truncated,
  };
}

export async function runQueryHandler(
  input: ZodOutput<typeof runQuery.input>,
  { paseo }: { paseo: AgentHost },
): Promise<QueryResult> {
  assertReadOnly(input.sql);
  const catalog = await catalogForQuery(paseo);
  const connectionId = connectionIdOf(input);
  const connection = catalog.connections.find((item) => item.id === connectionId);
  const raw = catalog.secrets.get(connectionId);
  if (!connection || !raw || !connection.canQuery) {
    throw new Error("No queryable Data Connection for that source.");
  }
  const secret = withDatabase(raw, input.database);
  const limit = input.limit ?? DEFAULT_LIMIT;
  try {
    if (secret.engine === "sqlite") {
      return await querySqlite(secret.file, input.sql, limit);
    }
    return await queryPostgres(secret, input.sql, limit);
  } catch (caught) {
    throw hidePgError(caught);
  }
}

export async function browseCatalogHandler(
  input: ZodOutput<typeof browseCatalog.input>,
  { paseo }: { paseo: AgentHost },
): Promise<BrowseResult> {
  const catalog = await catalogForQuery(paseo);
  const connectionId = connectionIdOf(input);
  const connection = catalog.connections.find((item) => item.id === connectionId);
  const secret = catalog.secrets.get(connectionId);
  if (!connection || !secret || !connection.canQuery) {
    throw new Error("No queryable Data Connection for that source.");
  }
  try {
    if (secret.engine === "sqlite") {
      return await browseSqlite(secret.file, connection.engine, input);
    }
    return await browsePostgres(secret, connection.engine, input);
  } catch (caught) {
    throw hidePgError(caught);
  }
}
