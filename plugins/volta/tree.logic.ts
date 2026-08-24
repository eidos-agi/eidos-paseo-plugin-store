import { FOLDER_KEY, type Chat } from "./tree.shared";

export type Mode = "folders" | "labels";

export type Row =
  | {
      kind: "folder";
      key: string;
      title: string;
      depth: number;
      count: number;
      open: boolean;
    }
  | {
      kind: "chat";
      key: string;
      title: string;
      depth: number;
      id: string;
      status: string;
      path: string;
    };

export function isHiddenLabel(key: string): boolean {
  return key === FOLDER_KEY || key.startsWith("paseo.");
}

export function normalizePath(raw: string): string {
  return raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function folderOf(chat: Chat): string {
  return normalizePath(chat.labels[FOLDER_KEY] ?? "");
}

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query);
}

type Node = {
  path: string;
  name: string;
  kids: Map<string, Node>;
  chats: Chat[];
};

function ensure(root: Node, path: string): Node {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let node = root;
  const acc: string[] = [];
  for (const part of parts) {
    acc.push(part);
    const nextPath = acc.join("/");
    let kid = node.kids.get(part);
    if (!kid) {
      kid = { path: nextPath, name: part, kids: new Map(), chats: [] };
      node.kids.set(part, kid);
    }
    node = kid;
  }
  return node;
}

function count(node: Node): number {
  let total = node.chats.length;
  for (const kid of node.kids.values()) {
    total += count(kid);
  }
  return total;
}

function subtreeHits(node: Node, query: string): boolean {
  if (!query) {
    return true;
  }
  if (matches(node.path, query) || matches(node.name, query)) {
    return true;
  }
  for (const chat of node.chats) {
    if (chatHits(chat, query)) {
      return true;
    }
  }
  for (const kid of node.kids.values()) {
    if (subtreeHits(kid, query)) {
      return true;
    }
  }
  return false;
}

function chatHits(chat: Chat, query: string): boolean {
  if (!query) {
    return true;
  }
  if (matches(chat.title, query) || matches(chat.id, query) || matches(folderOf(chat), query)) {
    return true;
  }
  return Object.entries(chat.labels).some(
    ([key, value]) => !isHiddenLabel(key) && (matches(key, query) || matches(value, query)),
  );
}

function flatten(
  node: Node,
  depth: number,
  query: string,
  expanded: Set<string>,
  rows: Row[],
): void {
  const kids = [...node.kids.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const kid of kids) {
    if (!subtreeHits(kid, query)) {
      continue;
    }
    const open = Boolean(query) || expanded.has(kid.path);
    rows.push({
      kind: "folder",
      key: `folder:${kid.path}`,
      title: kid.name,
      depth,
      count: count(kid),
      open,
    });
    if (!open) {
      continue;
    }
    flatten(kid, depth + 1, query, expanded, rows);
    const chats = [...kid.chats].sort((a, b) => a.title.localeCompare(b.title));
    for (const chat of chats) {
      if (!chatHits(chat, query)) {
        continue;
      }
      rows.push({
        kind: "chat",
        key: `chat:${kid.path}:${chat.id}`,
        title: chat.title,
        depth: depth + 1,
        id: chat.id,
        status: chat.status,
        path: kid.path,
      });
    }
  }
}

function foldersRoot(chats: Chat[], extraFolders: string[]): Node {
  const root: Node = { path: "", name: "", kids: new Map(), chats: [] };
  for (const path of extraFolders) {
    ensure(root, path);
  }
  const unfiled = ensure(root, "Unfiled");
  for (const chat of chats) {
    const path = folderOf(chat);
    if (path) {
      ensure(root, path).chats.push(chat);
    } else {
      unfiled.chats.push(chat);
    }
  }
  if (unfiled.chats.length === 0) {
    root.kids.delete("Unfiled");
  }
  return root;
}

function labelsRoot(chats: Chat[]): Node {
  const root: Node = { path: "", name: "", kids: new Map(), chats: [] };
  for (const chat of chats) {
    let placed = false;
    for (const [key, value] of Object.entries(chat.labels)) {
      if (isHiddenLabel(key) || !value.trim()) {
        continue;
      }
      placed = true;
      const path = `${key}/${normalizePath(value)}`;
      ensure(root, path).chats.push(chat);
    }
    if (!placed) {
      ensure(root, "Unlabelled").chats.push(chat);
    }
  }
  return root;
}

export function buildRows(
  chats: Chat[],
  extraFolders: string[],
  mode: Mode,
  query: string,
  expanded: Set<string>,
): Row[] {
  const root = mode === "folders" ? foldersRoot(chats, extraFolders) : labelsRoot(chats);
  const rows: Row[] = [];
  flatten(root, 0, query.trim().toLowerCase(), expanded, rows);
  return rows;
}

export const SEED_FOLDERS = [
  "paseo",
  "paseo/plugins",
  "paseo/plugins/volta",
  "paseo/plugins/page-pane",
  "paseo/plugins/ppm",
  "paseo/plugins/eidos-paseo-plugin-store",
  "paseo/plugins/prim-desktop",
];
