import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const pluginRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  path: z.string(),
  enabled: z.boolean().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  installed: z.boolean(),
  onDisk: z.boolean(),
  inRegistry: z.boolean(),
  self: z.boolean(),
  shelf: z.enum(["installed", "available", "unlisted"]),
  version: z.string().nullable(),
  publishedVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  downloadUrl: z.string().nullable(),
});

export const catalogOut = z.object({
  host: z.string(),
  catalogRoot: z.string(),
  registryPath: z.string(),
  catalogUrl: z.string(),
  publishedAt: z.string().nullable(),
  plugins: z.array(pluginRow),
});

export const logLine = z.object({
  timestamp: z.string(),
  stream: z.string(),
  message: z.string(),
});

export const loadCatalog = defineRpc({
  name: "ppm.catalog",
  input: z.object({}),
  output: catalogOut,
});

export const runAction = defineRpc({
  name: "ppm.action",
  input: z.object({
    id: z.string(),
    action: z.enum([
      "reload",
      "enable",
      "disable",
      "install",
      "uninstall",
      "register",
      "unregister",
      "update",
      "sync",
    ]),
    path: z.string().optional(),
  }),
  output: catalogOut,
});

export const loadLogs = defineRpc({
  name: "ppm.logs",
  input: z.object({ id: z.string() }),
  output: z.object({
    id: z.string(),
    lines: z.array(logLine),
  }),
});

export type Catalog = z.infer<typeof catalogOut>;
export type PluginRow = z.infer<typeof pluginRow>;
export type LogLine = z.infer<typeof logLine>;
