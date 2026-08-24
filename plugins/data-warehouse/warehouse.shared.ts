import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const engine = z.enum(["postgres", "sqlite", "mysql"]);
export const dsnRole = z.enum(["website", "warehouse", "ops", "local", "unknown"]);
export const dsnSource = z.enum(["env", "envfile", "asmp", "catalog", "workspace"]);

/** How the Data Connection was stored. DSN is the legacy file; prim.data-connection is the Prim. */
export const connectionFileType = z.enum(["dsn", "prim.data-connection"]);

export const dataConnection = z.object({
  id: z.string(),
  name: z.string(),
  engine,
  role: dsnRole,
  source: dsnSource,
  fileType: connectionFileType,
  endpoint: z.string(),
  status: z.string(),
  canQuery: z.boolean(),
  hint: z.string(),
  path: z.string().optional(),
  workspaceId: z.string().optional(),
  workspaceTitle: z.string().optional(),
});

/** @deprecated Use dataConnection. Kept as an alias so older imports typecheck during the rename. */
export const dsnSchema = dataConnection;

export const sqlSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "migration", "recipe", "model"]),
  bytes: z.number(),
  preview: z.string(),
  workspaceId: z.string().optional(),
  workspaceTitle: z.string().optional(),
});

export const workspaceRef = z.object({
  id: z.string(),
  title: z.string(),
  cwd: z.string(),
});

export const snapshotOut = z.object({
  host: z.string(),
  connections: z.array(dataConnection),
  sqls: z.array(sqlSchema),
  workspace: workspaceRef.optional(),
});

const connectionKey = z.object({
  connectionId: z.string().optional(),
  dsnId: z.string().optional(),
});

export const loadSnapshot = defineRpc({
  name: "warehouse.snapshot",
  input: z.object({ workspaceId: z.string().optional() }),
  output: snapshotOut,
});

export const readSql = defineRpc({
  name: "warehouse.sql.read",
  input: z.object({ path: z.string() }),
  output: z.object({
    path: z.string(),
    text: z.string(),
    truncated: z.boolean(),
  }),
});

export const runQuery = defineRpc({
  name: "warehouse.query",
  input: connectionKey.extend({
    sql: z.string().min(1).max(20_000),
    database: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  output: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string().nullable())),
    rowCount: z.number(),
    truncated: z.boolean(),
    ms: z.number(),
  }),
});

export const nodeKind = z.enum(["database", "schema", "table", "view", "column"]);

export const browseNode = z.object({
  name: z.string(),
  kind: nodeKind,
  detail: z.string().optional(),
  sql: z.string().optional(),
});

export const browseCatalog = defineRpc({
  name: "warehouse.browse",
  input: connectionKey.extend({
    database: z.string().optional(),
    schema: z.string().optional(),
    table: z.string().optional(),
  }),
  output: z.object({
    engine,
    database: z.string(),
    schema: z.string().optional(),
    table: z.string().optional(),
    items: z.array(browseNode),
    truncated: z.boolean(),
  }),
});

export type Engine = z.infer<typeof engine>;
export type DsnRole = z.infer<typeof dsnRole>;
export type DsnSource = z.infer<typeof dsnSource>;
export type ConnectionFileType = z.infer<typeof connectionFileType>;
export type DataConnection = z.infer<typeof dataConnection>;
export type Dsn = DataConnection;
export type SqlFile = z.infer<typeof sqlSchema>;
export type WorkspaceRef = z.infer<typeof workspaceRef>;
export type Snapshot = z.infer<typeof snapshotOut>;
export type QueryResult = z.infer<typeof runQuery.output>;
export type BrowseNode = z.infer<typeof browseNode>;
export type BrowseResult = z.infer<typeof browseCatalog.output>;

export function connectionIdOf(input: { connectionId?: string; dsnId?: string }): string {
  const id = input.connectionId || input.dsnId || "";
  if (!id) {
    throw new Error("Pick a Data Connection.");
  }
  return id;
}
