import { storeBlurb, storeRank, storeTitle, STORE } from "./ppm.store";

export const SELF_ID = "eidos-ppm";

export type InstalledPlugin = {
  id: string;
  path: string;
  enabled: boolean;
  status: string;
  error?: string | null;
  version?: string;
};

export type DiskPlugin = {
  manifestId: string;
  path: string;
  title?: string;
  description?: string;
  version?: string;
};

export type RegistryEntry = {
  id: string;
  title: string;
  blurb: string;
  path: string;
  addedAt: string;
};

export type PublishedPlugin = {
  id: string;
  title: string;
  blurb: string;
  version: string;
  source: string;
  download: string;
};

export type PluginRow = {
  id: string;
  title: string;
  description: string;
  path: string;
  enabled: boolean | null;
  status: string;
  error: string | null;
  installed: boolean;
  onDisk: boolean;
  inRegistry: boolean;
  self: boolean;
  shelf: "installed" | "available" | "unlisted";
  version: string | null;
  publishedVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
};

export type PluginAction =
  | "reload"
  | "enable"
  | "disable"
  | "install"
  | "uninstall"
  | "register"
  | "unregister"
  | "update"
  | "sync";

export type StoreFilter = "all" | "store" | "installed" | "unlisted";

export function versionNewer(published: string, local: string): boolean {
  const left = published.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = local.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const n = Math.max(left.length, right.length);
  for (let index = 0; index < n; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

export function parsePublishedCatalog(raw: unknown): PublishedPlugin[] {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const rows = rec?.plugins;
  if (!Array.isArray(rows)) {
    return [];
  }
  const published: PublishedPlugin[] = [];
  for (const row of rows) {
    const item = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const download = typeof item?.download === "string" ? item.download.trim() : "";
    const version = typeof item?.version === "string" ? item.version.trim() : "";
    if (!item || !id || !download || !version) {
      continue;
    }
    published.push({
      id,
      title: typeof item.title === "string" && item.title.trim() ? item.title : id,
      blurb: typeof item.blurb === "string" ? item.blurb : "",
      version,
      source: typeof item.source === "string" ? item.source : "",
      download,
    });
  }
  return published;
}

export function canRun(row: PluginRow, action: PluginAction): boolean {
  if (action === "sync") {
    return row.self;
  }
  if (action === "register") {
    return !row.inRegistry && Boolean(row.path || row.downloadUrl);
  }
  if (action === "unregister") {
    return row.inRegistry && !row.self;
  }
  if (action === "install") {
    return row.inRegistry && !row.installed && Boolean(row.path || row.downloadUrl);
  }
  if (action === "update") {
    return row.inRegistry && Boolean(row.downloadUrl) && row.updateAvailable;
  }
  if (!row.installed) {
    return false;
  }
  if (action === "reload") {
    return true;
  }
  if (action === "enable") {
    return row.enabled === false;
  }
  if (action === "disable") {
    return !row.self && row.enabled !== false;
  }
  if (action === "uninstall") {
    return !row.self;
  }
  return false;
}

export function upsertRegistry(current: RegistryEntry[], next: RegistryEntry): RegistryEntry[] {
  const without = current.filter((entry) => entry.id !== next.id && entry.path !== next.path);
  return [...without, next].sort((a, b) => storeRank(a.id) - storeRank(b.id) || a.title.localeCompare(b.title));
}

export function removeFromRegistry(current: RegistryEntry[], id: string): RegistryEntry[] {
  if (id === SELF_ID) {
    return current;
  }
  return current.filter((entry) => entry.id !== id);
}

export function seedRegistry(
  current: RegistryEntry[],
  installed: InstalledPlugin[],
  disk: DiskPlugin[],
  now: string,
  published: PublishedPlugin[] = [],
): RegistryEntry[] {
  let next = [...current];
  const seeds = [
    ...STORE,
    ...published
      .filter((plugin) => !STORE.some((entry) => entry.id === plugin.id))
      .map((plugin) => ({ id: plugin.id, title: plugin.title, blurb: plugin.blurb })),
  ];
  for (const seed of seeds) {
    if (next.some((entry) => entry.id === seed.id)) {
      continue;
    }
    const hit =
      installed.find((plugin) => plugin.id === seed.id) ??
      disk.find((plugin) => plugin.manifestId === seed.id);
    const pub = published.find((plugin) => plugin.id === seed.id);
    if (!hit?.path && !pub) {
      continue;
    }
    next = upsertRegistry(next, {
      id: seed.id,
      title: pub?.title ?? seed.title,
      blurb: pub?.blurb ?? seed.blurb,
      path: hit?.path ?? "",
      addedAt: now,
    });
  }
  return next;
}

export function syncPublished(current: RegistryEntry[], published: PublishedPlugin[], now: string): RegistryEntry[] {
  let next = [...current];
  for (const plugin of published) {
    if (next.some((entry) => entry.id === plugin.id)) {
      continue;
    }
    next = upsertRegistry(next, {
      id: plugin.id,
      title: plugin.title,
      blurb: plugin.blurb,
      path: "",
      addedAt: now,
    });
  }
  return next;
}

function lookupInstalled(id: string, path: string, installed: InstalledPlugin[]): InstalledPlugin | undefined {
  return installed.find((plugin) => plugin.id === id) ?? installed.find((plugin) => plugin.path === path);
}

function lookupDisk(id: string, path: string, disk: DiskPlugin[]): DiskPlugin | undefined {
  return disk.find((plugin) => plugin.path === path) ?? disk.find((plugin) => plugin.manifestId === id);
}

function overlay(
  live: InstalledPlugin | undefined,
  onDisk: DiskPlugin | undefined,
  published: PublishedPlugin | undefined,
): Pick<PluginRow, "version" | "publishedVersion" | "updateAvailable" | "downloadUrl"> {
  const version = live?.version || onDisk?.version || null;
  const publishedVersion = published?.version ?? null;
  const downloadUrl = published?.download ?? null;
  return {
    version,
    publishedVersion,
    downloadUrl,
    updateAvailable: Boolean(
      live && downloadUrl && publishedVersion && versionNewer(publishedVersion, version || "0.0.0"),
    ),
  };
}

export function mergeCatalog(
  registry: RegistryEntry[],
  installed: InstalledPlugin[],
  disk: DiskPlugin[],
  published: PublishedPlugin[] = [],
): PluginRow[] {
  const claimed = new Set<string>();
  const rows: PluginRow[] = [];
  const byPublished = new Map(published.map((plugin) => [plugin.id, plugin]));

  for (const entry of registry) {
    const live = lookupInstalled(entry.id, entry.path, installed);
    const onDisk = lookupDisk(entry.id, entry.path, disk);
    const pub = byPublished.get(entry.id);
    claimed.add(entry.id);
    if (live) {
      claimed.add(live.id);
    }
    if (onDisk) {
      claimed.add(onDisk.manifestId);
    }
    const path = live?.path || onDisk?.path || entry.path;
    const extra = overlay(live, onDisk, pub);
    rows.push({
      id: entry.id,
      title: storeTitle(entry.id, pub?.title ?? entry.title),
      description: storeBlurb(entry.id, pub?.blurb ?? entry.blurb),
      path,
      enabled: live ? live.enabled : null,
      status: live?.status ?? (path || extra.downloadUrl ? "available" : "missing"),
      error: live?.error ?? null,
      installed: Boolean(live),
      onDisk: Boolean(onDisk) || Boolean(path),
      inRegistry: true,
      self: entry.id === SELF_ID,
      shelf: live ? "installed" : "available",
      ...extra,
    });
  }

  for (const plugin of installed) {
    if (claimed.has(plugin.id)) {
      continue;
    }
    claimed.add(plugin.id);
    const onDisk = lookupDisk(plugin.id, plugin.path, disk);
    rows.push({
      id: plugin.id,
      title: storeTitle(plugin.id, onDisk?.title || plugin.id),
      description: storeBlurb(plugin.id, onDisk?.description),
      path: plugin.path,
      enabled: plugin.enabled,
      status: plugin.status || "unknown",
      error: plugin.error ?? null,
      installed: true,
      onDisk: Boolean(onDisk) || Boolean(plugin.path),
      inRegistry: false,
      self: plugin.id === SELF_ID,
      shelf: "unlisted",
      ...overlay(plugin, onDisk, byPublished.get(plugin.id)),
    });
  }

  for (const item of disk) {
    if (claimed.has(item.manifestId)) {
      continue;
    }
    claimed.add(item.manifestId);
    rows.push({
      id: item.manifestId,
      title: storeTitle(item.manifestId, item.title || item.manifestId),
      description: storeBlurb(item.manifestId, item.description),
      path: item.path,
      enabled: null,
      status: "unlisted",
      error: null,
      installed: false,
      onDisk: true,
      inRegistry: false,
      self: item.manifestId === SELF_ID,
      shelf: "unlisted",
      ...overlay(undefined, item, byPublished.get(item.manifestId)),
    });
  }

  return rows.sort((a, b) => {
    if (a.self !== b.self) {
      return a.self ? -1 : 1;
    }
    if (a.inRegistry !== b.inRegistry) {
      return a.inRegistry ? -1 : 1;
    }
    const rank = storeRank(a.id) - storeRank(b.id);
    if (rank !== 0) {
      return rank;
    }
    return a.title.localeCompare(b.title);
  });
}

export function filterStore(rows: PluginRow[], filter: StoreFilter): PluginRow[] {
  if (filter === "all") {
    return rows;
  }
  if (filter === "store") {
    return rows.filter((row) => row.inRegistry);
  }
  if (filter === "unlisted") {
    return rows.filter((row) => !row.inRegistry);
  }
  return rows.filter((row) => row.installed);
}

export function statusLabel(row: PluginRow): string {
  if (row.error) {
    return "error";
  }
  if (!row.inRegistry) {
    return row.installed ? "on this Paseo, not in store" : "not in store";
  }
  if (!row.installed) {
    return row.downloadUrl ? "in store · GitHub" : "in store";
  }
  if (row.updateAvailable && row.publishedVersion) {
    return `update ${row.publishedVersion}`;
  }
  if (row.enabled === false) {
    return "disabled";
  }
  return row.status || "unknown";
}

export function primaryAction(row: PluginRow): PluginAction | null {
  if (canRun(row, "register")) {
    return "register";
  }
  if (canRun(row, "install")) {
    return "install";
  }
  if (canRun(row, "update")) {
    return "update";
  }
  if (canRun(row, "enable")) {
    return "enable";
  }
  if (canRun(row, "reload")) {
    return "reload";
  }
  return null;
}
