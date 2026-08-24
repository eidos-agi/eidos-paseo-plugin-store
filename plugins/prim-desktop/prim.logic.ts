export const SECRET =
  /(api[_-]?key|secret|password|bearer\s|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,})/i;

export type Face = Record<string, string>;

export type PackRow = {
  id: string;
  title: string;
  profile: string;
  type: string;
  path: string;
  source: "memory" | "demo" | "docs" | "brand";
  admitted: boolean;
};

export type Session = {
  openId: string | null;
  tab: string;
  origin: string;
};

export type StoreFilter = "all" | "memory" | "demo";

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

export function packId(source: PackRow["source"], folder: string): string {
  const slug = folder.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pack";
  if (source === "memory") {
    return slug;
  }
  return `${source}-${slug}`;
}

export function safeRel(rel: string): string {
  const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.split("/").includes("..")) {
    throw new Error(`unsafe path: ${rel}`);
  }
  return norm;
}

export function filterPacks(rows: PackRow[], filter: StoreFilter): PackRow[] {
  if (filter === "memory") {
    return rows.filter((row) => row.admitted);
  }
  if (filter === "demo") {
    return rows.filter((row) => !row.admitted);
  }
  return rows;
}

export function viewerUrl(origin: string, row: PackRow | undefined, tab: string): string {
  if (!origin || !row) {
    return "";
  }
  const url = new URL("/view", origin);
  url.searchParams.set("id", row.id);
  url.searchParams.set("filename", `${row.id}.prim`);
  if (tab) {
    url.searchParams.set("tab", tab);
  }
  return url.toString();
}

export function parseQueueLine(line: string): { action: "open" | "tab"; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const open = trimmed.match(/^open\s+(.+)$/i);
  if (open?.[1]) {
    return { action: "open", value: open[1].trim() };
  }
  const tab = trimmed.match(/^tab\s+(.+)$/i);
  if (tab?.[1]) {
    return { action: "tab", value: tab[1].trim() };
  }
  return { action: "open", value: trimmed };
}
