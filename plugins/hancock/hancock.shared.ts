import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const requestRow = z.object({
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  reason: z.string(),
  risk: z.string(),
  status: z.string(),
  createdAt: z.string(),
  exitCode: z.number().nullable(),
  approver: z.string(),
  stderr: z.string(),
});

export const trayOut = z.object({
  host: z.string(),
  binary: z.string(),
  version: z.string(),
  statusLine: z.string(),
  filter: z.enum(["pending", "all"]),
  pending: z.number(),
  requests: z.array(requestRow),
  detailId: z.string().nullable(),
  detail: z.string(),
  error: z.string().nullable(),
});

export const loadTray = defineRpc({
  name: "hancock.tray",
  input: z.object({
    filter: z.enum(["pending", "all"]).optional(),
    id: z.string().optional(),
  }),
  output: trayOut,
});

export const runSign = defineRpc({
  name: "hancock.sign",
  input: z.object({
    id: z.string(),
    action: z.enum(["approve", "deny", "skip"]),
    filter: z.enum(["pending", "all"]).optional(),
  }),
  output: trayOut,
});

export type Tray = z.infer<typeof trayOut>;
export type RequestRow = z.infer<typeof requestRow>;
