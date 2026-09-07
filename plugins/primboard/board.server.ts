import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { output as ZodOutput } from "zod";
import {
  COLUMNS,
  defaultTab,
  groupBoard,
  oracleFromGrouped,
  parseFace,
  packViewerUrl,
  placePack,
  type PackCard,
  type Placement,
} from "./board.logic";
import { dropPack, loadBoard, openHost, selectPack, setTab, type Board } from "./board.shared";
import { APP_NAME, HOP, demoPacksRoot, seedRoots } from "./board.store";

const execFileAsync = promisify(execFile);

type Session = {
  openId: string | null;
  tab: string;
  origin: string;
};

function userHome(): string {
  return homedir().replace(/\/\.paseo$/, "") || homedir();
}

function paseoHome(): string {
  const home = homedir();
  return home.endsWith("/.paseo") ? home : join(home, ".paseo");
}

function libraryPath(): string {
  return join(paseoHome(), "prims");
}

function sessionPath(): string {
  return join(paseoHome(), "prim-desktop", "session.json");
}

function placementPath(): string {
  return join(userHome(), ".prim", "primboard.placement.json");
}

function loadPlacement(): Placement {
  try {
    const raw = JSON.parse(readFileSync(placementPath(), "utf8")) as Placement;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function savePlacement(placement: Placement): void {
  const path = placementPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(placement, null, 2)}\n`);
}

function readPack(id: string, path: string, source: PackCard["source"], admitted: boolean): PackCard | null {
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

function scanPacks(): PackCard[] {
  const home = userHome();
  const rows: PackCard[] = [];
  const seen = new Set<string>();
  const add = (row: PackCard | null) => {
    if (!row || seen.has(row.id) || seen.has(row.path)) {
      return;
    }
    seen.add(row.id);
    seen.add(row.path);
    rows.push(row);
  };

  const library = libraryPath();
  if (existsSync(library)) {
    for (const name of readdirSync(library)) {
      const path = join(library, name);
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

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

function loadSession(): Session {
  try {
    const raw = JSON.parse(readFileSync(sessionPath(), "utf8")) as Partial<Session>;
    return {
      openId: typeof raw.openId === "string" ? raw.openId : null,
      tab: typeof raw.tab === "string" && raw.tab ? raw.tab : "face",
      origin: typeof raw.origin === "string" ? raw.origin : "",
    };
  } catch {
    return { openId: null, tab: "face", origin: "" };
  }
}

function saveSession(session: Session): void {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`);
}

function listPackFiles(root: string): string[] {
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
      if (out.length >= 80) {
        return;
      }
    }
  };
  visit(root);
  return out.sort();
}

function readFace(path: string): string {
  const index = join(path, "index.md");
  try {
    const text = readFileSync(index, "utf8");
    return text.length > 8000 ? `${text.slice(0, 8000)}\n…` : text;
  } catch {
    return "";
  }
}

function findPrimFile(dir: string): string | null {
  try {
    const hit = readdirSync(dir).find((name) => name.endsWith(".prim") || name.endsWith(".opf"));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

function board(): Board {
  const packs = scanPacks();
  const session = loadSession();
  const grouped = groupBoard(packs, loadPlacement());
  const selected = packs.find((pack) => pack.id === session.openId);
  return {
    host: APP_NAME,
    libraryPath: libraryPath(),
    sessionPath: sessionPath(),
    selectedId: session.openId,
    tab: session.tab,
    viewerUrl: packViewerUrl(session.origin, selected, session.tab),
    face: selected ? readFace(selected.path) : "",
    files: selected ? listPackFiles(selected.path) : [],
    hop: HOP,
    columns: COLUMNS.map((column) => ({
      id: column.id,
      title: column.title,
      packs: grouped[column.id],
    })),
  };
}

function rowById(id: string): PackCard | undefined {
  return scanPacks().find((pack) => pack.id === id || pack.path === id || pack.title === id);
}

export function loadBoardHandler(_input: ZodOutput<typeof loadBoard.input>): Board {
  return board();
}

export function selectPackHandler(input: ZodOutput<typeof selectPack.input>): Board {
  const row = rowById(input.id);
  if (!row) {
    throw new Error(`Unknown prim ${input.id}`);
  }
  const current = loadSession();
  saveSession({
    openId: row.id,
    tab: defaultTab(row),
    origin: current.origin,
  });
  return board();
}

export function setTabHandler(input: ZodOutput<typeof setTab.input>): Board {
  const current = loadSession();
  saveSession({
    ...current,
    tab: input.tab || "face",
  });
  return board();
}

export function dropPackHandler(input: ZodOutput<typeof dropPack.input>): Board {
  const row = rowById(input.id);
  if (!row) {
    throw new Error(`Unknown prim ${input.id}`);
  }
  savePlacement(placePack(loadPlacement(), row.id, input.column));
  return board();
}

export function boardOracle(): ReturnType<typeof oracleFromGrouped> {
  return oracleFromGrouped(groupBoard(scanPacks(), loadPlacement()));
}

export async function openHostHandler(input: ZodOutput<typeof openHost.input>): Promise<Board> {
  const row = rowById(input.id);
  if (!row) {
    throw new Error(`Unknown prim ${input.id}`);
  }
  const current = loadSession();
  saveSession({
    openId: row.id,
    tab: defaultTab(row),
    origin: current.origin,
  });
  const target = findPrimFile(row.path) || row.path;
  try {
    await execFileAsync("open", ["-a", "Prims Desktop", target]);
  } catch {
    await execFileAsync("open", [row.path]);
  }
  return board();
}
