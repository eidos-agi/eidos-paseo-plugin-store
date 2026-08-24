export const APP_NAME = "Prim Desktop";
export const FULL_NAME = "Prims Desktop";
export const SELF_ID = "prim-desktop";
export const PANEL_ID = "prim-desktop";
export const PORT_START = 7411;

export type SeedRoot = {
  id: string;
  label: string;
  source: "docs" | "demo" | "brand";
  path: string;
};

export function seedRoots(userHome: string): SeedRoot[] {
  const web = `${userHome}/repos-eidos-agi/prim-web`;
  return [
    { id: "prim-docs", label: "Prim", source: "docs", path: `${web}/docs/pack` },
    { id: "mark-brand", label: "mark.brand", source: "brand", path: `${web}/brand/prim` },
  ];
}

export function demoPacksRoot(userHome: string): string {
  return `${userHome}/repos-eidos-agi/prim-web/demo/packs`;
}

export function viewerLibRoot(userHome: string): string {
  return `${userHome}/repos-eidos-agi/prim-web/docs`;
}
