import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { output as ZodOutput } from "zod";
import {
  canRun,
  mergeCatalog,
  parsePublishedCatalog,
  removeFromRegistry,
  seedRegistry,
  SELF_ID,
  syncPublished,
  upsertRegistry,
  type DiskPlugin,
  type InstalledPlugin,
  type PublishedPlugin,
  type RegistryEntry,
} from "./ppm.logic";
import {
  FULL_NAME,
  LATEST_CATALOG_URL,
  RAW_CATALOG_URL,
  storeBlurb,
  storeTitle,
} from "./ppm.store";
import {
  loadCatalog,
  loadLogs,
  runAction,
  type Catalog,
  type LogLine,
} from "./ppm.shared";

function paseoHome(): string {
  const home = homedir();
  if (home.endsWith("/.paseo")) {
    return home;
  }
  return join(home, ".paseo");
}

const USER_HOME = homedir().replace(/\/\.paseo$/, "") || homedir();
const FALLBACK_ROOTS = [
  join(USER_HOME, "repos-eidos-agi/eidos-paseo-plugin-store/plugins"),
  join(USER_HOME, "repos-eidos-agi/cockpit-paseo-workspaces/plugins"),
];
const REGISTRY_DIR = join(paseoHome(), "eidos-plugin-store");
const REGISTRY_PATH = join(REGISTRY_DIR, "registry.json");
const CACHE_ROOT = join(REGISTRY_DIR, "plugins");
const USER_AGENT = "Eidos-Paseo-Plugin-Store/0.1.0";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} failed (${code ?? "?"})`));
    });
  });
}

function runPaseo(args: string[]): Promise<string> {
  return runCommand("paseo", args);
}

async function listJson(args: string[]): Promise<unknown> {
  const raw = await runPaseo(args);
  return JSON.parse(raw) as unknown;
}

function readPackageMeta(dir: string): { title?: string; description?: string; version?: string } {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as unknown;
    const rec = asRecord(raw);
    return {
      title: str(rec?.name),
      description: str(rec?.description),
      version: str(rec?.version),
    };
  } catch {
    return {};
  }
}

function listInstalled(): Promise<InstalledPlugin[]> {
  return listJson(["plugin", "ls", "--json"]).then((raw) => {
    const rows = Array.isArray(raw) ? raw : [];
    const installed: InstalledPlugin[] = [];
    for (const row of rows) {
      const rec = asRecord(row);
      const id = str(rec?.id);
      if (!id) {
        continue;
      }
      const path = str(rec?.path) ?? "";
      installed.push({
        id,
        path,
        enabled: rec?.enabled !== false,
        status: str(rec?.status) ?? "unknown",
        error: str(rec?.error) ?? null,
        version: path ? readPackageMeta(path).version : undefined,
      });
    }
    return installed;
  });
}

function readManifestId(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "paseo-plugin.json"), "utf8")) as unknown;
    return str(asRecord(raw)?.id) ?? null;
  } catch {
    return null;
  }
}

function scanDisk(root: string): DiskPlugin[] {
  const found: DiskPlugin[] = [];
  try {
    for (const name of readdirSync(root)) {
      if (name.startsWith(".") || name === "node_modules") {
        continue;
      }
      const dir = join(root, name);
      try {
        if (!statSync(dir).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      const manifestId = readManifestId(dir);
      if (manifestId) {
        const meta = readPackageMeta(dir);
        found.push({
          manifestId,
          path: dir,
          title: meta.title,
          description: meta.description,
          version: meta.version,
        });
      }
    }
  } catch {
    return found;
  }
  return found;
}

function asEntry(value: unknown): RegistryEntry | null {
  const rec = asRecord(value);
  const id = str(rec?.id);
  if (!id) {
    return null;
  }
  return {
    id,
    title: str(rec?.title) ?? id,
    blurb: str(rec?.blurb) ?? "",
    path: str(rec?.path) ?? "",
    addedAt: str(rec?.addedAt) ?? new Date(0).toISOString(),
  };
}

function readRegistry(): RegistryEntry[] {
  try {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as unknown;
    const rec = asRecord(raw);
    const rows = rec?.plugins;
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map(asEntry).filter((item): item is RegistryEntry => item !== null);
  } catch {
    return [];
  }
}

function writeRegistry(plugins: RegistryEntry[]): RegistryEntry[] {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(
    REGISTRY_PATH,
    `${JSON.stringify(
      {
        name: FULL_NAME,
        version: 1,
        updatedAt: new Date().toISOString(),
        plugins,
      },
      null,
      2,
    )}\n`,
  );
  return plugins;
}

function catalogRoot(installed: InstalledPlugin[]): string {
  const self = installed.find((plugin) => plugin.id === SELF_ID);
  if (self?.path) {
    return dirname(self.path);
  }
  for (const root of FALLBACK_ROOTS) {
    try {
      if (statSync(root).isDirectory()) {
        return root;
      }
    } catch {
      continue;
    }
  }
  return FALLBACK_ROOTS[0];
}

async function fetchPublished(): Promise<{ plugins: PublishedPlugin[]; publishedAt: string | null; catalogUrl: string }> {
  for (const url of [LATEST_CATALOG_URL, RAW_CATALOG_URL]) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        redirect: "follow",
      });
      if (!response.ok) {
        continue;
      }
      const raw = (await response.json()) as unknown;
      const rec = asRecord(raw);
      return {
        plugins: parsePublishedCatalog(raw),
        publishedAt: str(rec?.updatedAt) ?? str(rec?.release) ?? null,
        catalogUrl: url,
      };
    } catch {
      continue;
    }
  }
  return { plugins: [], publishedAt: null, catalogUrl: LATEST_CATALOG_URL };
}

function loadRegistry(
  installed: InstalledPlugin[],
  disk: DiskPlugin[],
  published: PublishedPlugin[],
): RegistryEntry[] {
  const now = new Date().toISOString();
  const existing = readRegistry();
  if (existing.length === 0) {
    return writeRegistry(seedRegistry([], installed, disk, now, published));
  }
  const selfHit =
    installed.find((plugin) => plugin.id === SELF_ID) ??
    disk.find((plugin) => plugin.manifestId === SELF_ID);
  if (selfHit?.path && !existing.some((entry) => entry.id === SELF_ID)) {
    return writeRegistry(
      upsertRegistry(existing, {
        id: SELF_ID,
        title: storeTitle(SELF_ID, SELF_ID),
        blurb: storeBlurb(SELF_ID, FULL_NAME),
        path: selfHit.path,
        addedAt: now,
      }),
    );
  }
  return existing;
}

async function catalog(): Promise<Catalog> {
  const installed = await listInstalled().catch(() => [] as InstalledPlugin[]);
  const root = catalogRoot(installed);
  const disk = [
    ...scanDisk(root),
    ...FALLBACK_ROOTS.filter((candidate) => candidate !== root).flatMap(scanDisk),
  ];
  const remote = await fetchPublished();
  const registry = loadRegistry(installed, disk, remote.plugins);
  return {
    host: "this Paseo",
    catalogRoot: root,
    registryPath: REGISTRY_PATH,
    catalogUrl: remote.catalogUrl,
    publishedAt: remote.publishedAt,
    plugins: mergeCatalog(registry, installed, disk, remote.plugins),
  };
}

async function installFromDownload(id: string, url: string, version: string): Promise<string> {
  const dest = join(CACHE_ROOT, id, version || "latest");
  mkdirSync(dest, { recursive: true });
  const tarball = join(dest, `${id}.tar.gz`);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} for ${url}`);
  }
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  const extractTo = join(dest, "_extract");
  rmSync(extractTo, { recursive: true, force: true });
  mkdirSync(extractTo, { recursive: true });
  await runCommand("tar", ["-xzf", tarball, "-C", extractTo]);
  const nested = join(extractTo, id);
  const pluginDir = readManifestId(nested) ? nested : extractTo;
  if (!readManifestId(pluginDir)) {
    throw new Error(`Tarball for ${id} did not contain paseo-plugin.json`);
  }
  const live = join(dest, "plugin");
  rmSync(live, { recursive: true, force: true });
  await runCommand("cp", ["-R", pluginDir, live]);
  await runCommand("npm", ["install"], live);
  return live;
}

export async function loadCatalogHandler(
  _input: ZodOutput<typeof loadCatalog.input>,
): Promise<Catalog> {
  return catalog();
}

export async function runActionHandler(
  input: ZodOutput<typeof runAction.input>,
): Promise<Catalog> {
  const current = await catalog();
  if (input.action === "sync") {
    const remote = await fetchPublished();
    writeRegistry(syncPublished(readRegistry(), remote.plugins, new Date().toISOString()));
    return catalog();
  }
  const row = current.plugins.find((plugin) => plugin.id === input.id);
  if (!row) {
    throw new Error(`Unknown plugin ${input.id}`);
  }
  if (!canRun(row, input.action)) {
    throw new Error(`Cannot ${input.action} ${input.id}`);
  }
  if (input.action === "register") {
    const path = input.path || row.path;
    writeRegistry(
      upsertRegistry(readRegistry(), {
        id: row.id,
        title: row.title,
        blurb: row.description,
        path,
        addedAt: new Date().toISOString(),
      }),
    );
  } else if (input.action === "unregister") {
    writeRegistry(removeFromRegistry(readRegistry(), input.id));
  } else if (input.action === "install" || input.action === "update") {
    let path = input.path || row.path;
    if (input.action === "update" || !path) {
      const url = row.downloadUrl;
      if (!url) {
        throw new Error(`No GitHub download URL for ${input.id}`);
      }
      path = await installFromDownload(input.id, url, row.publishedVersion || "latest");
    }
    await runPaseo(["plugin", "install", path]);
    writeRegistry(
      upsertRegistry(readRegistry(), {
        id: row.id,
        title: row.title,
        blurb: row.description,
        path,
        addedAt: new Date().toISOString(),
      }),
    );
    if (row.installed || input.action === "update") {
      await runPaseo(["plugin", "reload", input.id]).catch(() => undefined);
    }
  } else if (input.action === "uninstall") {
    await runPaseo(["plugin", "remove", input.id]);
  } else {
    await runPaseo(["plugin", input.action, input.id]);
  }
  return catalog();
}

export async function loadLogsHandler(
  input: ZodOutput<typeof loadLogs.input>,
): Promise<{ id: string; lines: LogLine[] }> {
  const raw = await listJson(["plugin", "logs", input.id, "--json"]).catch(() => []);
  const rows = Array.isArray(raw) ? raw : [];
  const lines: LogLine[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const message = str(rec?.message);
    if (!message) {
      continue;
    }
    lines.push({
      timestamp: str(rec?.timestamp) ?? "",
      stream: str(rec?.stream) ?? "stdout",
      message,
    });
  }
  return { id: input.id, lines: lines.slice(-80) };
}
