import type { BrowseNode, ConnectionFileType, DataConnection, DsnRole, Engine, SqlFile } from "./warehouse.shared";

export type Filter = "all" | "sources" | "sqls";

const READ_START = new Set(["SELECT", "WITH", "EXPLAIN", "SHOW", "PRAGMA", "VALUES", "TABLE"]);

export function redactEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const withoutUser = trimmed.replace(/(\w+:\/\/)([^/@]+)@/g, "$1");
  try {
    const normalized = withoutUser
      .replace(/^postgres(ql)?:/i, "http:")
      .replace(/^mysql:/i, "http:")
      .replace(/^sqlite:/i, "http:");
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) && trimmed.startsWith("/")) {
      return trimmed;
    }
    const url = new URL(normalized);
    const host = url.host || url.hostname;
    const path = url.pathname === "/" ? "" : url.pathname;
    const proto = trimmed.split(":")[0] ?? url.protocol.replace(":", "");
    if (!host && path) {
      return `${proto}:${path}`;
    }
    return `${proto}://${host}${path}`;
  } catch {
    return withoutUser.replace(/:[^:@/]+@/, "@");
  }
}

export function postgresEndpoint(host: string, port: string, database: string, user: string): string {
  const who = user ? `${user}@` : "";
  return `postgres://${who}${host}:${port}/${database}`;
}

export function classifyRole(name: string, endpoint: string, keys: string[]): DsnRole {
  const blob = `${name} ${endpoint} ${keys.join(" ")}`.toLowerCase();
  if (blob.includes("dbt_pg") || blob.includes("warehouse")) {
    return "warehouse";
  }
  if (blob.includes("supabase") || blob.includes("website")) {
    return "website";
  }
  if (blob.includes("dagster") || blob.includes("ops") || blob.includes("run_storage")) {
    return "ops";
  }
  if (blob.includes("sqlite") || endpoint.endsWith(".sqlite") || endpoint.endsWith(".sqlite3")) {
    return "local";
  }
  return "unknown";
}

export function classifyEngine(name: string, endpoint: string): Engine {
  const blob = `${name} ${endpoint}`.toLowerCase();
  if (blob.includes("sqlite")) {
    return "sqlite";
  }
  if (blob.includes("mysql")) {
    return "mysql";
  }
  return "postgres";
}

export function classifySql(relPath: string): SqlFile["kind"] {
  const path = relPath.toLowerCase();
  if (path.includes("migration")) {
    return "migration";
  }
  if (path.includes("/models/") || path.includes("dbt_project")) {
    return "model";
  }
  if (path.includes("odwf") || path.includes("recipe") || /row\d+\.sql$/.test(path)) {
    return "recipe";
  }
  return "file";
}

export function firstKeyword(sql: string): string {
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim();
  const parts = stripped
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 1) {
    throw new Error("Run one SQL statement.");
  }
  const match = /^([A-Za-z]+)/.exec(parts[0] ?? "");
  return (match?.[1] ?? "").toUpperCase();
}

export function assertReadOnly(sql: string): void {
  const keyword = firstKeyword(sql);
  if (!READ_START.has(keyword)) {
    throw new Error("Read-only viewer. Use SELECT, WITH, or EXPLAIN.");
  }
}

export function matchesQuery(haystack: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return haystack.toLowerCase().includes(query);
}

export function filterConnections(connections: DataConnection[], query: string): DataConnection[] {
  const needle = query.trim().toLowerCase();
  return connections.filter((item) =>
    matchesQuery(
      [
        item.name,
        item.engine,
        item.role,
        item.fileType,
        item.endpoint,
        item.hint,
        item.workspaceTitle ?? "",
      ].join(" "),
      needle,
    ),
  );
}

/** @deprecated Use filterConnections. */
export const filterDsns = filterConnections;

export function filterSqls(sqls: SqlFile[], query: string): SqlFile[] {
  const needle = query.trim().toLowerCase();
  return sqls.filter((sql) =>
    matchesQuery([sql.name, sql.path, sql.kind, sql.preview, sql.workspaceTitle ?? ""].join(" "), needle),
  );
}

export function roleLabel(role: DsnRole): string {
  if (role === "warehouse") {
    return "warehouse";
  }
  if (role === "website") {
    return "website";
  }
  if (role === "ops") {
    return "ops";
  }
  if (role === "local") {
    return "local";
  }
  return "connection";
}

export function fileTypeLabel(fileType: ConnectionFileType): string {
  return fileType === "prim.data-connection" ? "prim.data-connection" : "DSN";
}

const IDENTITY_KEYS = ["name", "make", "model", "year", "vin", "id", "vehicle_id", "email", "title", "code"];

export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function parseJsonCell(text: string | null): unknown {
  if (!text) {
    return undefined;
  }
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function previewCell(text: string | null): string {
  if (text == null) {
    return "∅";
  }
  const parsed = parseJsonCell(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>;
    const bits: string[] = [];
    for (const key of IDENTITY_KEYS) {
      const value = rec[key];
      if (value != null && value !== "") {
        bits.push(String(value));
      }
      if (bits.length >= 3) {
        break;
      }
    }
    if (bits.length) {
      return bits.join(" · ");
    }
    const keys = Object.keys(rec);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}}`;
  }
  if (Array.isArray(parsed)) {
    return `[${parsed.length}]`;
  }
  return text.length > 56 ? `${text.slice(0, 53)}…` : text;
}

export function prettyCell(text: string | null): string {
  if (text == null) {
    return "";
  }
  const parsed = parseJsonCell(text);
  if (parsed === undefined) {
    return text;
  }
  return JSON.stringify(parsed, null, 2);
}

export function columnWidth(column: string, values: (string | null)[]): number {
  let widest = column.length;
  for (const value of values.slice(0, 24)) {
    widest = Math.max(widest, previewCell(value).length);
  }
  return Math.min(280, Math.max(92, widest * 8 + 18));
}

export function quoteIdent(engine: Engine, name: string): string {
  if (engine === "mysql") {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function qualifyTable(engine: Engine, schema: string | undefined, table: string): string {
  if (!schema || (engine === "sqlite" && schema === "main")) {
    return quoteIdent(engine, table);
  }
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`;
}

export function selectStar(
  engine: Engine,
  schema: string | undefined,
  table: string,
  limit = 100,
): string {
  return `select * from ${qualifyTable(engine, schema, table)} limit ${limit}`;
}

export function catalogKey(connectionId: string, database = "", schema = "", table = ""): string {
  return [connectionId, database, schema, table].join("\t");
}

export type TreeRow = {
  key: string;
  kind: "connection" | "dsn" | "database" | "schema" | "table" | "view" | "column";
  name: string;
  depth: number;
  open: boolean;
  expandable: boolean;
  detail?: string;
  connectionId: string;
  dsnId: string;
  database?: string;
  schema?: string;
  table?: string;
  sql?: string;
  canQuery: boolean;
};

export function singletonName(items: BrowseNode[], kind: BrowseNode["kind"]): string | undefined {
  if (items.length !== 1 || items[0]?.kind !== kind || !items[0].name) {
    return undefined;
  }
  return items[0].name;
}

export function filterNodes(items: BrowseNode[], query: string): BrowseNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return items;
  }
  return items.filter((item) => matchesQuery([item.name, item.kind, item.detail ?? ""].join(" "), needle));
}

export function flattenCatalog(
  connections: DataConnection[],
  expanded: Set<string>,
  kids: Record<string, BrowseNode[]>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const dsn of connections) {
    const dsnKey = catalogKey(dsn.id);
    const dsnOpen = expanded.has(dsnKey);
    rows.push({
      key: dsnKey,
      kind: "connection",
      name: dsn.name,
      depth: 0,
      open: dsnOpen,
      expandable: dsn.canQuery,
      detail: `${dsn.engine} · ${fileTypeLabel(dsn.fileType)} · ${roleLabel(dsn.role)} · ${dsn.status}`,
      connectionId: dsn.id,
      dsnId: dsn.id,
      canQuery: dsn.canQuery,
    });
    if (!dsnOpen) {
      continue;
    }
    for (const database of kids[dsnKey] ?? []) {
      const databaseKey = catalogKey(dsn.id, database.name);
      const databaseOpen = expanded.has(databaseKey);
      rows.push({
        key: databaseKey,
        kind: "database",
        name: database.name,
        depth: 1,
        open: databaseOpen,
        expandable: true,
        detail: database.detail,
        connectionId: dsn.id,
        dsnId: dsn.id,
        database: database.name,
        canQuery: dsn.canQuery,
      });
      if (!databaseOpen) {
        continue;
      }
      for (const schema of kids[databaseKey] ?? []) {
        const schemaKey = catalogKey(dsn.id, database.name, schema.name);
        const schemaOpen = expanded.has(schemaKey);
        rows.push({
          key: schemaKey,
          kind: "schema",
          name: schema.name,
          depth: 2,
          open: schemaOpen,
          expandable: true,
          detail: schema.detail,
          connectionId: dsn.id,
          dsnId: dsn.id,
          database: database.name,
          schema: schema.name,
          canQuery: dsn.canQuery,
        });
        if (!schemaOpen) {
          continue;
        }
        for (const table of kids[schemaKey] ?? []) {
          const tableKey = catalogKey(dsn.id, database.name, schema.name, table.name);
          const tableOpen = expanded.has(tableKey);
          rows.push({
            key: tableKey,
            kind: table.kind === "view" ? "view" : "table",
            name: table.name,
            depth: 3,
            open: tableOpen,
            expandable: true,
            detail: table.detail,
            connectionId: dsn.id,
            dsnId: dsn.id,
            database: database.name,
            schema: schema.name,
            table: table.name,
            sql: table.sql ?? selectStar(dsn.engine, schema.name, table.name),
            canQuery: dsn.canQuery,
          });
          if (!tableOpen) {
            continue;
          }
          for (const column of kids[tableKey] ?? []) {
            rows.push({
              key: `${tableKey}\t${column.name}`,
              kind: "column",
              name: column.name,
              depth: 4,
              open: false,
              expandable: false,
              detail: column.detail,
              connectionId: dsn.id,
              dsnId: dsn.id,
              database: database.name,
              schema: schema.name,
              table: table.name,
              canQuery: dsn.canQuery,
            });
          }
        }
      }
    }
  }
  return rows;
}
