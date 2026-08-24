import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const FOLDER_KEY = "folder";

export const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  workspaceId: z.string().optional(),
  cwd: z.string().optional(),
  labels: z.record(z.string(), z.string()),
});

export const workspaceSchema = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  projectId: z.string().optional(),
  cwd: z.string(),
  status: z.string(),
});

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
});

export const catalogOut = z.object({
  chats: z.array(chatSchema),
  folders: z.array(z.string()),
  workspaces: z.array(workspaceSchema),
  projects: z.array(projectSchema),
});

export const loadCatalog = defineRpc({
  name: "volta.catalog",
  input: z.object({}),
  output: catalogOut,
});

export const fileChat = defineRpc({
  name: "volta.file",
  input: z.object({
    agentId: z.string(),
    folder: z.string(),
  }),
  output: catalogOut,
});

export const createFolder = defineRpc({
  name: "volta.folder.create",
  input: z.object({ path: z.string() }),
  output: catalogOut,
});

export const openChat = defineRpc({
  name: "volta.open",
  input: z.object({ agentId: z.string() }),
  output: z.object({ opened: z.boolean() }),
});

export const stampTenants = defineRpc({
  name: "volta.tenants.stamp",
  input: z.object({}),
  output: z.object({
    updated: z.number(),
    skipped: z.number(),
    failed: z.number(),
    byTenant: z.record(z.string(), z.number()),
  }),
});

export type Chat = z.infer<typeof chatSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Catalog = z.infer<typeof catalogOut>;
