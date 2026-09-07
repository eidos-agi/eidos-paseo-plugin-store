export type PackSource = "memory" | "demo" | "docs" | "brand";

export type BoardColumnId = PackSource;

export type PackCard = {
  id: string;
  title: string;
  profile: string;
  type: string;
  path: string;
  source: PackSource;
  admitted: boolean;
};

export type Face = Record<string, string>;

export const COLUMNS: { id: BoardColumnId; title: string }[] = [
  { id: "memory", title: "Memory" },
  { id: "demo", title: "Demo" },
  { id: "docs", title: "Docs" },
  { id: "brand", title: "Brand" },
];

export function parseFace(text: string): Face {
  const face: Face = {};
  if (!text.startsWith("---")) {
    return face;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return face;
  }
  for (const line of text.slice(3, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("- ") || !trimmed.includes(":")) {
      continue;
    }
    if (line.length - line.trimStart().length >= 2) {
      continue;
    }
    const i = trimmed.indexOf(":");
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value) {
      face[key] = value;
    }
  }
  return face;
}

export function packId(source: PackSource, folder: string): string {
  const slug = folder.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pack";
  if (source === "memory") {
    return slug;
  }
  return `${source}-${slug}`;
}

export type Placement = Partial<Record<string, BoardColumnId>>;

export type Rect = { x: number; y: number; width: number; height: number };

export type DragOracle = Record<BoardColumnId, string[]>;

export function axCard(id: string): string {
  return `primboard.card.${id}`;
}

export function axColumn(id: BoardColumnId): string {
  return `primboard.column.${id}`;
}

export function columnFor(pack: PackCard, placement: Placement = {}): BoardColumnId {
  const placed = placement[pack.id];
  if (placed) {
    return placed;
  }
  if (pack.admitted || pack.source === "memory") {
    return "memory";
  }
  return pack.source;
}

export function groupBoard(packs: PackCard[], placement: Placement = {}): Record<BoardColumnId, PackCard[]> {
  const out: Record<BoardColumnId, PackCard[]> = {
    memory: [],
    demo: [],
    docs: [],
    brand: [],
  };
  for (const pack of packs) {
    out[columnFor(pack, placement)].push(pack);
  }
  return out;
}

export function placePack(placement: Placement, packId: string, column: BoardColumnId): Placement {
  return { ...placement, [packId]: column };
}

export function oracleFromGrouped(grouped: Record<BoardColumnId, PackCard[]>): DragOracle {
  return {
    memory: grouped.memory.map((pack) => pack.id),
    demo: grouped.demo.map((pack) => pack.id),
    docs: grouped.docs.map((pack) => pack.id),
    brand: grouped.brand.map((pack) => pack.id),
  };
}

export function findOracleColumn(oracle: DragOracle, packId: string): BoardColumnId | null {
  for (const id of COLUMNS.map((column) => column.id)) {
    if (oracle[id].includes(packId)) {
      return id;
    }
  }
  return null;
}

/** True only if the pack left its old column and is now listed in `to`. */
export function dragSucceeded(before: DragOracle, after: DragOracle, packId: string, to: BoardColumnId): boolean {
  const from = findOracleColumn(before, packId);
  if (!from) {
    return false;
  }
  if (!after[to].includes(packId)) {
    return false;
  }
  if (from === to) {
    return false;
  }
  return !after[from].includes(packId);
}

export function hitColumn(x: number, y: number, frames: Partial<Record<BoardColumnId, Rect>>): BoardColumnId | null {
  for (const id of COLUMNS.map((column) => column.id)) {
    const frame = frames[id];
    if (!frame) {
      continue;
    }
    if (x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height) {
      return id;
    }
  }
  return null;
}

export type AxNode = {
  axidentifier?: string;
  name?: string;
  x: number;
  y: number;
};

export function findAx(nodes: AxNode[], id: string): AxNode | null {
  return nodes.find((node) => node.axidentifier === id || node.name === id) ?? null;
}

export function packKind(pack: PackCard): string {
  return [pack.profile, pack.type].filter(Boolean).join(" · ") || pack.source;
}

export function defaultTab(pack: PackCard): string {
  return pack.profile === "album" || pack.type === "album" ? "play" : "face";
}

export const EXPLORE_TABS = ["face", "play", "files"] as const;
export type ExploreTab = (typeof EXPLORE_TABS)[number];

export function packViewerUrl(origin: string, pack: PackCard | undefined, tab: string): string {
  if (!origin || !pack) {
    return "";
  }
  const url = new URL("/view", origin);
  url.searchParams.set("id", pack.id);
  url.searchParams.set("filename", `${pack.id}.prim`);
  if (tab) {
    url.searchParams.set("tab", tab);
  }
  return url.toString();
}
