export const APP_NAME = "Eidos Plugin Store";
export const FULL_NAME = "Eidos Paseo Plugin Store";
export const GITHUB_REPO = "eidos-agi/eidos-paseo-plugin-store";
export const LATEST_CATALOG_URL =
  `https://github.com/${GITHUB_REPO}/releases/latest/download/catalog.json`;
export const RAW_CATALOG_URL =
  `https://raw.githubusercontent.com/${GITHUB_REPO}/main/catalog.json`;
export const LATEST_INSTALL_URL =
  `https://github.com/${GITHUB_REPO}/releases/latest/download/install.sh`;

export function pluginDownloadUrl(id: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/latest/download/${id}.tar.gz`;
}

export type StoreEntry = {
  id: string;
  title: string;
  blurb: string;
};

export const STORE: StoreEntry[] = [
  {
    id: "eidos-ppm",
    title: APP_NAME,
    blurb: `${FULL_NAME}. Manages every plugin on this daemon.`,
  },
  {
    id: "volta",
    title: "Volta",
    blurb: "Desk: tenant → product → chat. Live work sits bright; last season stays dim.",
  },
  {
    id: "page-pane",
    title: "Paseo Browserbase",
    blurb: "Cloud Chrome groups as workspace tabs.",
  },
  {
    id: "paseo-dbms",
    title: "PaseoDBMS",
    blurb: "Data Connections and a read-only SQL viewer.",
  },
  {
    id: "prim-desktop",
    title: "Prim Desktop",
    blurb: "Load and control Prims on this Paseo. The pack stays the file.",
  },
  {
    id: "hancock",
    title: "Hancock",
    blurb: "Human signing desk. Agents queue; you approve, deny, or skip.",
  },
];

export function storeEntry(id: string): StoreEntry | undefined {
  return STORE.find((entry) => entry.id === id);
}

export function storeTitle(id: string, fallback?: string): string {
  return storeEntry(id)?.title ?? fallback ?? id;
}

export function storeBlurb(id: string, fallback?: string): string {
  return storeEntry(id)?.blurb ?? fallback ?? "";
}

export function storeRank(id: string): number {
  const index = STORE.findIndex((entry) => entry.id === id);
  return index >= 0 ? index : 100 + id.localeCompare("m");
}
