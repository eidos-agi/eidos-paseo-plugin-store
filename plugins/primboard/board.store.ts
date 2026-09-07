export const APP_NAME = "Primboard";
export const PANEL_ID = "primboard";
export const SELF_ID = "primboard";
export const HOP = "prim-desktop";

export type SeedRoot = {
  id: string;
  label: string;
  source: "docs" | "demo" | "brand";
  path: string;
};

export function seedRoots(userHome: string): SeedRoot[] {
  const web = `${userHome}/repos-eidos-agi/prim-web`;
  const arcade = `${userHome}/repos-eidos-agi/eidos-arcade`;
  return [
    { id: "prim-docs", label: "Prim", source: "docs", path: `${web}/docs/pack` },
    { id: "mark-brand", label: "mark.brand", source: "brand", path: `${web}/brand/prim` },
    {
      id: "gentleman-groove",
      label: "Gentleman Groove",
      source: "demo",
      path: `${arcade}/soundtrack/goldeneye-007-elegant-deep-house`,
    },
  ];
}

export function demoPacksRoot(userHome: string): string {
  return `${userHome}/repos-eidos-agi/prim-web/demo/packs`;
}
