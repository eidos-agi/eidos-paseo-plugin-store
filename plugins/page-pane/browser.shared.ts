import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import { agentGroupLink, GROUP_SLOT_COUNT, pageSize, snapshotOut, viewMode, viewPrefs } from "./browser.model";

export {
  agentGroupLink,
  groupView,
  pageSize,
  pageView,
  snapshotOut,
  viewMode,
  viewPrefs,
} from "./browser.model";
export type { AgentGroupLink, GroupView, PageView, Snapshot, ViewPrefs } from "./browser.model";

export const groupSnapshot = defineRpc({
  name: "group.snapshot",
  input: z.object({
    workspaceId: z.string().optional(),
    slot: z.number().int().min(0).max(GROUP_SLOT_COUNT - 1).optional(),
  }),
  output: snapshotOut,
});

export const groupStart = defineRpc({
  name: "group.start",
  input: z.object({
    url: z.string(),
    workspaceId: z.string().optional(),
    slot: z.number().int().min(0).max(GROUP_SLOT_COUNT - 1).optional(),
  }),
  output: snapshotOut,
});

export const groupPage = defineRpc({
  name: "group.page",
  input: z.object({ groupId: z.string().optional(), url: z.string() }),
  output: snapshotOut,
});

export const groupGo = defineRpc({
  name: "group.go",
  input: z.object({ groupId: z.string(), pageId: z.string().optional(), url: z.string() }),
  output: snapshotOut,
});

export const groupBack = defineRpc({
  name: "group.back",
  input: z.object({ groupId: z.string(), pageId: z.string().optional() }),
  output: snapshotOut,
});

export const groupReload = defineRpc({
  name: "group.reload",
  input: z.object({ groupId: z.string(), pageId: z.string().optional() }),
  output: snapshotOut,
});

export const linkAdd = defineRpc({
  name: "link.add",
  input: agentGroupLink,
  output: snapshotOut,
});

export const linkRemove = defineRpc({
  name: "link.remove",
  input: agentGroupLink,
  output: snapshotOut,
});

export const viewSet = defineRpc({
  name: "view.set",
  input: z.object({
    mode: viewMode.optional(),
    defaultSize: pageSize.optional(),
  }),
  output: snapshotOut,
});
