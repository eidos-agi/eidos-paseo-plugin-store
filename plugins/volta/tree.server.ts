import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import { isLive, TENANT_LABEL_KEY, tenantStamps } from "./desk.logic";
import { SEED_FOLDERS, normalizePath } from "./tree.logic";
import {
  FOLDER_KEY,
  createFolder,
  fileChat,
  loadCatalog,
  openChat,
  stampTenants,
  type Catalog,
  type Chat,
  type Project,
  type Workspace,
} from "./tree.shared";

type AgentHost = {
  agents: {
    list(options?: { page?: { limit: number; cursor?: string } }): Promise<{
      entries?: unknown[];
      pageInfo?: { nextCursor?: string };
    }>;
  };
  workspaces?: {
    list(options?: { page?: { limit: number; cursor?: string } }): Promise<{
      entries?: unknown[];
      pageInfo?: { nextCursor?: string };
    }>;
  };
};

const STATE_DIR = join(homedir(), ".paseo/volta");
const LEGACY_STATE = join(homedir(), ".paseo/label-tree/folders.json");
const STATE_PATH = join(STATE_DIR, "folders.json");

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function readFolderFile(path: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { folders?: unknown };
    return Array.isArray(raw.folders)
      ? raw.folders.filter((item): item is string => typeof item === "string").map(normalizePath)
      : [];
  } catch {
    return [];
  }
}

function loadFolders(): string[] {
  return uniquePaths([...SEED_FOLDERS, ...readFolderFile(STATE_PATH), ...readFolderFile(LEGACY_STATE)]);
}

function saveFolders(folders: string[]): string[] {
  const next = uniquePaths([...SEED_FOLDERS, ...folders]);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify({ folders: next }, null, 2)}\n`);
  return next;
}

async function runPaseo(args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
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
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `paseo ${args.join(" ")} failed (${code ?? "?"})`));
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (typeof value === "string") {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      labels[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return labels;
  }
  const rec = asRecord(value);
  if (!rec) {
    return labels;
  }
  for (const [key, item] of Object.entries(rec)) {
    if (typeof item === "string") {
      labels[key] = item;
    }
  }
  return labels;
}

function expandHome(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function asRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  const rec = asRecord(raw);
  if (!rec) {
    return [];
  }
  for (const key of ["agents", "workspaces", "projects", "entries", "items"]) {
    const value = rec[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function asStatus(agent: Record<string, unknown>, rec: Record<string, unknown> | null): string {
  const turn = asRecord(agent.activeTurn) ?? asRecord(rec?.activeTurn);
  if (turn) {
    return "running";
  }
  const raw = (
    str(agent.status) ??
    str(rec?.status) ??
    str(agent.state) ??
    str(agent.agentStatus)
  )?.toLowerCase();
  if (raw) {
    return raw;
  }
  const reason = str(agent.attentionReason) ?? str(rec?.attentionReason);
  if (agent.requiresAttention === true || rec?.requiresAttention === true) {
    if (reason === "permission") {
      return "needs_input";
    }
    if (reason === "error") {
      return "error";
    }
  }
  return "idle";
}

function asChat(entry: unknown): Chat | null {
  const rec = asRecord(entry);
  const agent = asRecord(rec?.agent) ?? rec;
  if (!agent) {
    return null;
  }
  const id = str(agent.id);
  if (!id) {
    return null;
  }
  const title = str(agent.title) || str(agent.name) || id.slice(0, 8);
  const labels = asLabels(agent.labels ?? agent.tags ?? rec?.labels);
  return {
    id,
    title,
    status: asStatus(agent, rec),
    workspaceId: str(agent.workspaceId),
    cwd: expandHome(str(agent.cwd) ?? str(agent.directory)),
    labels,
  };
}

function asWorkspace(entry: unknown): Workspace | null {
  const rec = asRecord(entry);
  if (!rec) {
    return null;
  }
  const id = str(rec.id) ?? str(rec.workspaceId);
  if (!id) {
    return null;
  }
  return {
    id,
    title: str(rec.title) || str(rec.name) || id.slice(0, 8),
    project: str(rec.project) || str(rec.projectDisplayName) || str(rec.projectName) || "Other",
    projectId: str(rec.projectId),
    cwd: expandHome(str(rec.cwd) || str(rec.directory) || str(rec.workspaceDirectory)) || "",
    status: str(rec.status) ?? "done",
  };
}

function asProject(entry: unknown): Project | null {
  const rec = asRecord(entry);
  if (!rec) {
    return null;
  }
  const id = str(rec.id) ?? str(rec.projectId);
  const name = str(rec.name) ?? str(rec.title);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    path: str(rec.path) || str(rec.rootPath) || str(rec.projectRootPath) || "",
  };
}

async function paginate<T>(
  read: (cursor?: string) => Promise<unknown>,
  parse: (entry: unknown) => T | null,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page = asRecord(await read(cursor)) ?? {};
    const entries = asRows(page.entries ?? page.items ?? page.agents ?? page);
    for (const entry of entries) {
      const item = parse(entry);
      if (item) {
        items.push(item);
      }
    }
    const pageInfo = asRecord(page.pageInfo);
    const next = str(pageInfo?.nextCursor) ?? str(page.nextCursor);
    if (!next) {
      break;
    }
    cursor = next;
  }
  return items;
}

async function listChats(paseo: AgentHost): Promise<Chat[]> {
  return paginate(
    (cursor) => paseo.agents.list({ page: cursor ? { limit: 100, cursor } : { limit: 100 } }),
    asChat,
  );
}

async function listWorkspacesFromSdk(paseo: AgentHost): Promise<Workspace[]> {
  if (!paseo.workspaces?.list) {
    return [];
  }
  try {
    return await paginate(
      (cursor) => paseo.workspaces!.list({ page: cursor ? { limit: 100, cursor } : { limit: 100 } }),
      asWorkspace,
    );
  } catch {
    return [];
  }
}

async function listJson(args: string[]): Promise<unknown> {
  const raw = await runPaseo(args);
  return JSON.parse(raw) as unknown;
}

async function listWorkspacesFromCli(): Promise<Workspace[]> {
  const raw = await listJson(["workspace", "ls", "--json"]);
  return asRows(raw).map(asWorkspace).filter((item): item is Workspace => item !== null);
}

async function listProjectsFromCli(): Promise<Project[]> {
  const raw = await listJson(["project", "ls", "--json"]);
  return asRows(raw).map(asProject).filter((item): item is Project => item !== null);
}

async function listChatsFromCli(): Promise<Chat[]> {
  const raw = await listJson(["agent", "ls", "--json"]);
  return asRows(raw).map(asChat).filter((item): item is Chat => item !== null);
}

function mergeChats(sdkChats: Chat[], cliChats: Chat[]): Chat[] {
  const byId = new Map<string, Chat>();
  for (const chat of sdkChats) {
    byId.set(chat.id, chat);
  }
  for (const chat of cliChats) {
    const existing = byId.get(chat.id);
    if (!existing) {
      byId.set(chat.id, chat);
      continue;
    }
    byId.set(chat.id, {
      ...existing,
      title: existing.title || chat.title,
      cwd: existing.cwd || chat.cwd,
      status: isLive(chat.status) ? chat.status : existing.status,
      workspaceId: existing.workspaceId ?? chat.workspaceId,
      labels: { ...chat.labels, ...existing.labels },
    });
  }
  return [...byId.values()];
}

async function catalog(paseo: AgentHost): Promise<Catalog> {
  const [sdkChats, cliChats, sdkWorkspaces, cliWorkspaces, projects] = await Promise.all([
    listChats(paseo).catch(() => [] as Chat[]),
    listChatsFromCli().catch(() => [] as Chat[]),
    listWorkspacesFromSdk(paseo),
    listWorkspacesFromCli().catch(() => [] as Workspace[]),
    listProjectsFromCli().catch(() => [] as Project[]),
  ]);
  const workspaces = new Map<string, Workspace>();
  for (const workspace of [...cliWorkspaces, ...sdkWorkspaces]) {
    workspaces.set(workspace.id, workspace);
  }
  const merged = mergeChats(sdkChats, cliChats);
  const histogram = new Map<string, number>();
  for (const chat of merged) {
    histogram.set(chat.status, (histogram.get(chat.status) ?? 0) + 1);
  }
  console.log("volta catalog", {
    sdk: sdkChats.length,
    cli: cliChats.length,
    chats: merged.length,
    statuses: Object.fromEntries(histogram),
    live: merged.filter((chat) => isLive(chat.status)).length,
  });
  return {
    chats: merged,
    folders: loadFolders(),
    workspaces: [...workspaces.values()],
    projects,
  };
}

export async function loadCatalogHandler(
  _input: ZodOutput<typeof loadCatalog.input>,
  { paseo }: { paseo: AgentHost },
): Promise<Catalog> {
  return catalog(paseo);
}

export async function fileChatHandler(
  input: ZodOutput<typeof fileChat.input>,
  { paseo }: { paseo: AgentHost },
): Promise<Catalog> {
  const folder = normalizePath(input.folder);
  await runPaseo(["agent", "update", input.agentId, "--label", `${FOLDER_KEY}=${folder}`]);
  if (folder) {
    saveFolders([...loadFolders(), folder]);
  }
  return catalog(paseo);
}

export async function createFolderHandler(
  input: ZodOutput<typeof createFolder.input>,
  { paseo }: { paseo: AgentHost },
): Promise<Catalog> {
  const path = normalizePath(input.path);
  if (path) {
    saveFolders([...loadFolders(), path]);
  }
  return catalog(paseo);
}

export async function openChatHandler(input: ZodOutput<typeof openChat.input>): Promise<{
  opened: boolean;
}> {
  await runPaseo(["agent", "open", input.agentId]);
  return { opened: true };
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function run(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }
  const workers = Math.min(Math.max(limit, 1), Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workers }, () => run()));
}

export async function stampTenantsHandler(
  _input: ZodOutput<typeof stampTenants.input>,
  { paseo }: { paseo: AgentHost },
): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  byTenant: Record<string, number>;
}> {
  const snapshot = await catalog(paseo);
  const stamps = tenantStamps(snapshot);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const byTenant: Record<string, number> = {};
  await mapPool(stamps, 5, async (stamp) => {
    if (stamp.current === stamp.tenant) {
      skipped += 1;
      return;
    }
    try {
      await runPaseo([
        "agent",
        "update",
        stamp.agentId,
        "--label",
        `${TENANT_LABEL_KEY}=${stamp.tenant}`,
      ]);
      updated += 1;
      byTenant[stamp.tenant] = (byTenant[stamp.tenant] ?? 0) + 1;
    } catch (error) {
      failed += 1;
      console.error("volta stamp failed", stamp.agentId, stamp.tenant, error);
    }
  });
  console.log("volta stamp", { updated, skipped, failed, byTenant, planned: stamps.length });
  return { updated, skipped, failed, byTenant };
}
