import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import type { output as ZodOutput } from "zod";
import {
  parseFace,
  parseQueueLine,
  safeRel,
  SECRET,
  viewerUrl,
  type PackRow,
  type Session,
} from "./prim.logic";
import {
  demoPacksRoot,
  FULL_NAME,
  PORT_START,
  seedRoots,
  viewerLibRoot,
} from "./prim.store";
import {
  admitPack,
  listFiles,
  loadCatalog,
  loadFace,
  loadStatus,
  openPack,
  readFile,
  setTab,
  type Catalog,
} from "./prim.shared";

function userHome(): string {
  return homedir().replace(/\/\.paseo$/, "") || homedir();
}

function paseoHome(): string {
  const home = homedir();
  return home.endsWith("/.paseo") ? home : join(home, ".paseo");
}

const LIBRARY = join(paseoHome(), "prims");
const STATE_DIR = join(paseoHome(), "prim-desktop");
const QUEUE_PATH = join(STATE_DIR, "queue");
const SESSION_PATH = join(STATE_DIR, "session.json");
const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let httpServer: Server | null = null;
let origin = "";
let session: Session = { openId: null, tab: "face", origin: "" };

function ensureDirs(): void {
  mkdirSync(LIBRARY, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(QUEUE_PATH)) {
    writeFileSync(QUEUE_PATH, "");
  }
}

function loadSession(): Session {
  try {
    const raw = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as Partial<Session>;
    return {
      openId: typeof raw.openId === "string" ? raw.openId : null,
      tab: typeof raw.tab === "string" && raw.tab ? raw.tab : "face",
      origin,
    };
  } catch {
    return { openId: null, tab: "face", origin };
  }
}

function saveSession(): void {
  ensureDirs();
  session.origin = origin;
  writeFileSync(SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`);
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let ents: string[] = [];
    try {
      ents = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of ents) {
      if (name.startsWith(".") || name === "node_modules") {
        continue;
      }
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        visit(path);
      } else if (st.isFile()) {
        out.push(relative(root, path).replace(/\\/g, "/"));
      }
    }
  };
  visit(root);
  return out.sort();
}

function readPack(id: string, path: string, source: PackRow["source"], admitted: boolean): PackRow | null {
  const index = join(path, "index.md");
  if (!existsSync(index)) {
    return null;
  }
  const face = parseFace(readFileSync(index, "utf8"));
  return {
    id,
    title: face.title || id,
    profile: face.profile || "",
    type: face.type || "",
    path,
    source,
    admitted,
  };
}

function scanPacks(): PackRow[] {
  const home = userHome();
  const rows: PackRow[] = [];
  const seen = new Set<string>();
  const add = (row: PackRow | null) => {
    if (!row || seen.has(row.id) || seen.has(row.path)) {
      return;
    }
    seen.add(row.id);
    seen.add(row.path);
    rows.push(row);
  };

  if (existsSync(LIBRARY)) {
    for (const name of readdirSync(LIBRARY)) {
      const path = join(LIBRARY, name);
      try {
        if (!statSync(path).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      add(readPack(name, path, "memory", true));
    }
  }

  for (const seed of seedRoots(home)) {
    add(readPack(seed.id, seed.path, seed.source, false));
  }

  const demos = demoPacksRoot(home);
  if (existsSync(demos)) {
    for (const name of readdirSync(demos)) {
      const path = join(demos, name);
      try {
        if (!statSync(path).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      add(readPack(`demo-${name}`, path, "demo", false));
    }
  }

  return rows.sort((a, b) => {
    if (a.admitted !== b.admitted) {
      return a.admitted ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

function rowById(id: string): PackRow | undefined {
  return scanPacks().find((row) => row.id === id || row.path === id || row.title === id);
}

function requireOpen(id?: string): PackRow {
  const row = rowById(id || session.openId || "");
  if (!row) {
    throw new Error("No prim is open");
  }
  return row;
}

function drainQueue(): void {
  if (!existsSync(QUEUE_PATH)) {
    return;
  }
  const raw = readFileSync(QUEUE_PATH, "utf8");
  if (!raw.trim()) {
    return;
  }
  writeFileSync(QUEUE_PATH, "");
  for (const line of raw.split(/\n/)) {
    const cmd = parseQueueLine(line);
    if (!cmd) {
      continue;
    }
    if (cmd.action === "tab") {
      session.tab = cmd.value;
      continue;
    }
    const row = rowById(cmd.value);
    if (!row) {
      continue;
    }
    if (!row.admitted) {
      continue;
    }
    session.openId = row.id;
  }
  saveSession();
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(body);
}

function underRoot(root: string, rel: string): string | null {
  const full = resolve(root, rel);
  if (!full.startsWith(resolve(root) + "/") && full !== resolve(root)) {
    return null;
  }
  return full;
}

function viewerHtml(id: string, tab: string, filename: string): string {
  const src = `/pack/${encodeURIComponent(id)}/`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${filename}</title>
  <style>
    html, body, show-prim { height: 100%; margin: 0; background: #f4f3ef; color: #111; }
    show-prim { display: block; }
  </style>
</head>
<body>
  <show-prim src="${src}" tab="${tab}" filename="${filename}"></show-prim>
  <script type="module" src="/js/showprim.js"></script>
</body>
</html>
`;
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || "/", origin || "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
    return;
  }
  if (url.pathname === "/view") {
    const id = url.searchParams.get("id") || session.openId || "";
    const tab = url.searchParams.get("tab") || session.tab || "face";
    const filename = url.searchParams.get("filename") || `${id}.prim`;
    send(res, 200, viewerHtml(id, tab, filename), "text/html; charset=utf-8");
    return;
  }
  if (url.pathname.startsWith("/js/")) {
    const rel = safeRel(url.pathname.slice(4));
    const root = viewerLibRoot(userHome());
    const full = underRoot(root, rel);
    if (!full || !existsSync(full) || !statSync(full).isFile()) {
      send(res, 404, "missing viewer", "text/plain");
      return;
    }
    send(res, 200, readFileSync(full), MIME[extname(full)] || "application/octet-stream");
    return;
  }
  if (url.pathname.startsWith("/pack/")) {
    const rest = url.pathname.slice("/pack/".length);
    const slash = rest.indexOf("/");
    const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
    const rel = slash === -1 ? "index.md" : decodeURIComponent(rest.slice(slash + 1));
    const row = rowById(id);
    if (!row) {
      send(res, 404, "unknown pack", "text/plain");
      return;
    }
    const full = underRoot(row.path, rel || "index.md");
    if (!full || !existsSync(full)) {
      send(res, 404, "missing file", "text/plain");
      return;
    }
    if (statSync(full).isDirectory()) {
      const index = join(full, "index.md");
      if (existsSync(index)) {
        send(res, 200, readFileSync(index), "text/markdown; charset=utf-8");
        return;
      }
      send(res, 404, "directory", "text/plain");
      return;
    }
    send(res, 200, readFileSync(full), MIME[extname(full)] || "application/octet-stream");
    return;
  }
  send(res, 404, "not found", "text/plain");
}

function listen(port: number): Promise<string> {
  return new Promise((resolveListen, reject) => {
    const server = createServer(handleHttp);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      httpServer = server;
      origin = `http://127.0.0.1:${port}`;
      resolveListen(origin);
    });
  });
}

let starting: Promise<() => void> | null = null;

export function startViewer(): Promise<() => void> {
  if (starting) {
    return starting;
  }
  starting = bootViewer();
  return starting;
}

async function bootViewer(): Promise<() => void> {
  ensureDirs();
  session = loadSession();
  if (!httpServer) {
    let last: unknown;
    for (let port = PORT_START; port < PORT_START + 12; port += 1) {
      try {
        await listen(port);
        last = null;
        break;
      } catch (error) {
        last = error;
      }
    }
    if (!httpServer) {
      throw last instanceof Error ? last : new Error("Could not bind Prim Desktop viewer");
    }
  }
  session.origin = origin;
  saveSession();
  return () => {
    httpServer?.close();
    httpServer = null;
    starting = null;
  };
}

function catalog(): Catalog {
  drainQueue();
  session.origin = origin;
  const packs = scanPacks();
  const open = packs.find((row) => row.id === session.openId);
  return {
    host: FULL_NAME,
    libraryPath: LIBRARY,
    queuePath: QUEUE_PATH,
    session: {
      openId: session.openId,
      tab: session.tab,
      origin,
      viewerUrl: viewerUrl(origin, open, session.tab),
    },
    packs,
  };
}

export async function loadCatalogHandler(_input: ZodOutput<typeof loadCatalog.input>): Promise<Catalog> {
  await startViewer();
  return catalog();
}

export async function openPackHandler(input: ZodOutput<typeof openPack.input>): Promise<Catalog> {
  await startViewer();
  const key = input.id || input.src || "";
  const row = rowById(key);
  if (!row) {
    throw new Error(`Unknown prim ${key}`);
  }
  session.openId = row.id;
  session.tab = "face";
  saveSession();
  return catalog();
}

export async function setTabHandler(input: ZodOutput<typeof setTab.input>): Promise<Catalog> {
  await startViewer();
  session.tab = input.tab;
  saveSession();
  return catalog();
}

export async function admitPackHandler(input: ZodOutput<typeof admitPack.input>): Promise<Catalog> {
  await startViewer();
  const row = rowById(input.id);
  if (!row) {
    throw new Error(`Unknown prim ${input.id}`);
  }
  if (row.admitted) {
    return catalog();
  }
  ensureDirs();
  const dest = join(LIBRARY, row.id.replace(/^(demo|docs|brand)-/, ""));
  cpSync(row.path, dest, { recursive: true });
  session.openId = dest.slice(LIBRARY.length + 1) || row.id;
  const admitted = readPack(session.openId, dest, "memory", true);
  if (admitted) {
    session.openId = admitted.id;
  }
  saveSession();
  return catalog();
}

export async function loadStatusHandler(_input: ZodOutput<typeof loadStatus.input>) {
  await startViewer();
  if (!session.openId) {
    return {
      open: false,
      id: null,
      title: "",
      profile: "",
      type: "",
      tab: session.tab,
      files: [] as string[],
      admitted: false,
    };
  }
  const row = requireOpen();
  return {
    open: true,
    id: row.id,
    title: row.title,
    profile: row.profile,
    type: row.type,
    tab: session.tab,
    files: walkFiles(row.path),
    admitted: row.admitted,
  };
}

export async function listFilesHandler(input: ZodOutput<typeof listFiles.input>) {
  await startViewer();
  const row = requireOpen(input.id);
  return { id: row.id, files: walkFiles(row.path) };
}

export async function loadFaceHandler(input: ZodOutput<typeof loadFace.input>) {
  await startViewer();
  const row = requireOpen(input.id);
  const body = readFileSync(join(row.path, "index.md"), "utf8");
  return {
    id: row.id,
    title: row.title,
    profile: row.profile,
    type: row.type,
    body,
  };
}

export async function readFileHandler(input: ZodOutput<typeof readFile.input>) {
  await startViewer();
  const row = requireOpen(input.id);
  const rel = safeRel(input.path);
  const full = join(row.path, rel);
  const text = readFileSync(full, "utf8");
  if (SECRET.test(text)) {
    throw new Error(`Refused to read ${rel}: looks like a secret`);
  }
  return { id: row.id, path: rel, text };
}
