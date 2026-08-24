import {
  canRun,
  filterStore,
  mergeCatalog,
  parsePublishedCatalog,
  primaryAction,
  removeFromRegistry,
  seedRegistry,
  SELF_ID,
  upsertRegistry,
  versionNewer,
  type DiskPlugin,
  type InstalledPlugin,
  type PluginRow,
  type RegistryEntry,
} from "./ppm.logic";

function fail(message: string): never {
  throw new Error(message);
}

function expect(ok: unknown, message: string): void {
  if (!ok) {
    fail(message);
  }
}

const now = "2026-08-24T18:00:00.000Z";
const installed: InstalledPlugin[] = [
  { id: SELF_ID, path: "/plugins/eidos-ppm", enabled: true, status: "running", version: "0.1.0" },
  { id: "volta", path: "/plugins/label-tree", enabled: true, status: "running", version: "0.0.0" },
  { id: "mystery", path: "/plugins/mystery", enabled: true, status: "running" },
];
const disk: DiskPlugin[] = [
  { manifestId: SELF_ID, path: "/plugins/eidos-ppm", title: "ppm", description: "store" },
  { manifestId: "volta", path: "/plugins/label-tree", title: "Volta" },
  { manifestId: "page-pane", path: "/plugins/page-pane", title: "Browser" },
  { manifestId: "stray", path: "/plugins/stray", title: "Stray" },
];

const seeded = seedRegistry([], installed, disk, now);
expect(
  seeded.map((entry) => entry.id).join(",") === "eidos-ppm,volta,page-pane",
  `seed should take STORE hits only, got ${seeded.map((entry) => entry.id).join(",")}`,
);
expect(
  seedRegistry(seeded, installed, disk, now).length === seeded.length,
  "seed should not duplicate",
);

const registry: RegistryEntry[] = seeded;
const rows = mergeCatalog(registry, installed, disk);
const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

expect(byId[SELF_ID]?.inRegistry === true && byId[SELF_ID]?.shelf === "installed", "self is in store and installed");
expect(byId.volta?.inRegistry === true, "volta is in store");
expect(byId["page-pane"]?.installed === false && byId["page-pane"]?.inRegistry === true, "page-pane is store-only");
expect(byId.mystery?.inRegistry === false && byId.mystery?.shelf === "unlisted", "installed mystery stays unlisted");
expect(byId.stray?.inRegistry === false && byId.stray?.installed === false, "disk stray stays unlisted");
expect(filterStore(rows, "store").every((row) => row.inRegistry), "store filter");
expect(filterStore(rows, "unlisted").every((row) => !row.inRegistry), "unlisted filter");
expect(primaryAction(byId.stray as PluginRow) === "register", "unlisted disk primary is add to store");
expect(primaryAction(byId["page-pane"] as PluginRow) === "install", "store-only primary is add to this Paseo");
expect(canRun(byId[SELF_ID] as PluginRow, "unregister") === false, "cannot unregister self");
expect(canRun(byId.mystery as PluginRow, "install") === false, "cannot install until registered");
expect(canRun(byId.stray as PluginRow, "register") === true, "can add unlisted to store");
expect(
  removeFromRegistry(registry, SELF_ID).some((entry) => entry.id === SELF_ID),
  "removeFromRegistry keeps self",
);
expect(
  upsertRegistry(registry, {
    id: "stray",
    title: "Stray",
    blurb: "",
    path: "/plugins/stray",
    addedAt: now,
  }).some((entry) => entry.id === "stray"),
  "upsert adds stray",
);

const published = [
  {
    id: "volta",
    title: "Volta",
    blurb: "desk",
    version: "0.2.0",
    source: "plugins/volta",
    download: "https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/volta.tar.gz",
  },
  {
    id: "ghost",
    title: "Ghost",
    blurb: "from github",
    version: "1.0.0",
    source: "plugins/ghost",
    download: "https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/ghost.tar.gz",
  },
];
expect(versionNewer("0.1.0", "0.0.0"), "0.1.0 is newer than 0.0.0");
expect(!versionNewer("0.1.0", "0.1.0"), "same version is not newer");
expect(parsePublishedCatalog({ plugins: published }).length === 2, "parse catalog plugins");

const githubSeed = seedRegistry([], installed, disk, now, published);
expect(
  githubSeed.some((entry) => entry.id === "ghost"),
  "empty registry seeds published plugins that are not on disk",
);

const githubRows = mergeCatalog(registry, installed, disk, published);
const githubById = Object.fromEntries(githubRows.map((row) => [row.id, row]));
expect(githubById.volta?.updateAvailable === true, "volta 0.0.0 vs published 0.2.0 is updateable");
expect(githubById.volta?.downloadUrl?.includes("/releases/latest/download/volta.tar.gz") === true, "volta download URL is latest");
expect(canRun(githubById.volta as PluginRow, "update") === true, "can update volta from GitHub");

const remoteOnly: PluginRow = {
  id: "ghost",
  title: "Ghost",
  description: "from github",
  path: "",
  enabled: null,
  status: "available",
  error: null,
  installed: false,
  onDisk: false,
  inRegistry: true,
  self: false,
  shelf: "available",
  version: null,
  publishedVersion: "1.0.0",
  updateAvailable: false,
  downloadUrl: published[1].download,
};
expect(canRun(remoteOnly, "install") === true, "can install from GitHub without a local path");
expect(primaryAction(remoteOnly) === "install", "GitHub-only primary is install");

console.log(
  JSON.stringify(
    {
      ok: true,
      seeded: seeded.map((entry) => entry.id),
      shelves: Object.fromEntries(rows.map((row) => [row.id, { shelf: row.shelf, inRegistry: row.inRegistry }])),
    },
    null,
    2,
  ),
);
