import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const packRow = z.object({
  id: z.string(),
  title: z.string(),
  profile: z.string(),
  type: z.string(),
  path: z.string(),
  source: z.enum(["memory", "demo", "docs", "brand"]),
  admitted: z.boolean(),
});

export const sessionOut = z.object({
  openId: z.string().nullable(),
  tab: z.string(),
  origin: z.string(),
  viewerUrl: z.string(),
});

export const catalogOut = z.object({
  host: z.string(),
  libraryPath: z.string(),
  queuePath: z.string(),
  session: sessionOut,
  packs: z.array(packRow),
});

export const loadCatalog = defineRpc({
  name: "prim.catalog",
  input: z.object({}),
  output: catalogOut,
});

export const openPack = defineRpc({
  name: "prim.open",
  input: z.object({
    id: z.string().optional(),
    src: z.string().optional(),
  }),
  output: catalogOut,
});

export const setTab = defineRpc({
  name: "prim.tab",
  input: z.object({ tab: z.string() }),
  output: catalogOut,
});

export const admitPack = defineRpc({
  name: "prim.admit",
  input: z.object({ id: z.string() }),
  output: catalogOut,
});

export const loadStatus = defineRpc({
  name: "prim.status",
  input: z.object({}),
  output: z.object({
    open: z.boolean(),
    id: z.string().nullable(),
    title: z.string(),
    profile: z.string(),
    type: z.string(),
    tab: z.string(),
    files: z.array(z.string()),
    admitted: z.boolean(),
  }),
});

export const listFiles = defineRpc({
  name: "prim.files",
  input: z.object({ id: z.string().optional() }),
  output: z.object({
    id: z.string(),
    files: z.array(z.string()),
  }),
});

export const loadFace = defineRpc({
  name: "prim.face",
  input: z.object({ id: z.string().optional() }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    profile: z.string(),
    type: z.string(),
    body: z.string(),
  }),
});

export const readFile = defineRpc({
  name: "prim.read",
  input: z.object({
    path: z.string(),
    id: z.string().optional(),
  }),
  output: z.object({
    id: z.string(),
    path: z.string(),
    text: z.string(),
  }),
});

export type Catalog = z.infer<typeof catalogOut>;
export type PackRow = z.infer<typeof packRow>;
export type Status = z.infer<typeof loadStatus.output>;
