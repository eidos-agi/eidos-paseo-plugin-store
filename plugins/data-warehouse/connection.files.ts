import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ConnectionFileType } from "./warehouse.shared";

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

const MAX_DEPTH = 5;
const MAX_FILES = 80;

export type ConnectionFileRecord = {
  id: string;
  name: string;
  fileType: ConnectionFileType;
  path: string;
  role?: string;
  engine?: string;
  envFile?: string;
  sqlite?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(raw: string, root: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  return resolve(root, trimmed);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function fromFields(
  rec: Record<string, unknown>,
  fileType: ConnectionFileType,
  path: string,
  root: string,
): ConnectionFileRecord | null {
  const id = str(rec.id);
  const name = str(rec.name) || str(rec.title);
  if (!id || !name) {
    return null;
  }
  const envFile = str(rec.envFile);
  const sqlite = str(rec.sqlite);
  return {
    id,
    name,
    fileType,
    path,
    role: str(rec.role),
    engine: str(rec.engine),
    envFile: envFile ? expandHome(envFile, root) : undefined,
    sqlite: sqlite ? expandHome(sqlite, root) : undefined,
  };
}

export function parseDsnFile(path: string): ConnectionFileRecord[] {
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch {
    return [];
  }
  const rec = asRecord(raw);
  if (Array.isArray(raw)) {
    const root = dirname(path);
    const out: ConnectionFileRecord[] = [];
    for (const entry of raw) {
      const item = asRecord(entry);
      if (!item) {
        continue;
      }
      const parsed = fromFields(item, "dsn", path, root);
      if (parsed) {
        out.push(parsed);
      }
    }
    return out;
  }
  if (!rec) {
    return [];
  }
  const format = str(rec.format);
  if (format === "prim.data-connection") {
    return [];
  }
  const root = dirname(path);
  const rows = Array.isArray(rec.dsns) ? rec.dsns : [rec];
  const out: ConnectionFileRecord[] = [];
  for (const entry of rows) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }
    const parsed = fromFields(item, "dsn", path, root);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export function parsePrimDataConnection(path: string): ConnectionFileRecord | null {
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch {
    return null;
  }
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  const format = str(rec.format);
  if (format !== "prim.data-connection") {
    return null;
  }
  const nested = asRecord(rec.connection);
  const fields = nested ? { ...rec, ...nested } : rec;
  return fromFields(fields, "prim.data-connection", path, dirname(path));
}

function considerFile(full: string, name: string, found: ConnectionFileRecord[]): void {
  if (found.length >= MAX_FILES) {
    return;
  }
  if (name === "dsns.json" || name.endsWith(".dsn.json")) {
    found.push(...parseDsnFile(full));
    return;
  }
  if (name === "data-connection.json" || name.endsWith(".data-connection.json")) {
    const parsed = parsePrimDataConnection(full);
    if (parsed) {
      found.push(parsed);
    }
  }
}

export function walkConnectionFiles(root: string, rel = "", depth = 0, found: ConnectionFileRecord[] = []): ConnectionFileRecord[] {
  if (found.length >= MAX_FILES || depth > MAX_DEPTH) {
    return found;
  }
  const dir = rel ? join(root, rel) : root;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (found.length >= MAX_FILES) {
      break;
    }
    if (name.startsWith(".") && name !== ".paseo") {
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
      if (SKIP_DIRS.has(name)) {
        continue;
      }
      if (name.endsWith(".data-connection")) {
        const nested = join(full, "data-connection.json");
        if (existsSync(nested)) {
          const parsed = parsePrimDataConnection(nested);
          if (parsed) {
            found.push(parsed);
          }
        }
        continue;
      }
      walkConnectionFiles(root, nextRel, depth + 1, found);
      continue;
    }
    if (stat.isFile()) {
      considerFile(full, name, found);
    }
  }
  return found;
}
