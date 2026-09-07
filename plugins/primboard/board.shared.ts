import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const packCard = z.object({
  id: z.string(),
  title: z.string(),
  profile: z.string(),
  type: z.string(),
  path: z.string(),
  source: z.enum(["memory", "demo", "docs", "brand"]),
  admitted: z.boolean(),
});

export const columnOut = z.object({
  id: z.enum(["memory", "demo", "docs", "brand"]),
  title: z.string(),
  packs: z.array(packCard),
});

export const boardOut = z.object({
  host: z.string(),
  libraryPath: z.string(),
  sessionPath: z.string(),
  selectedId: z.string().nullable(),
  tab: z.string(),
  viewerUrl: z.string(),
  face: z.string(),
  files: z.array(z.string()),
  hop: z.string(),
  columns: z.array(columnOut),
});

export const loadBoard = defineRpc({
  name: "primboard.catalog",
  input: z.object({}),
  output: boardOut,
});

export const selectPack = defineRpc({
  name: "primboard.select",
  input: z.object({ id: z.string() }),
  output: boardOut,
});

export const setTab = defineRpc({
  name: "primboard.tab",
  input: z.object({ tab: z.string() }),
  output: boardOut,
});

export const openHost = defineRpc({
  name: "primboard.open-host",
  input: z.object({ id: z.string() }),
  output: boardOut,
});

export const dropPack = defineRpc({
  name: "primboard.drop",
  input: z.object({
    id: z.string(),
    column: z.enum(["memory", "demo", "docs", "brand"]),
  }),
  output: boardOut,
});

export type Board = z.infer<typeof boardOut>;
export type PackCard = z.infer<typeof packCard>;
