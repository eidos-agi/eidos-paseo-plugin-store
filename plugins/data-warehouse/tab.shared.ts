import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const DATA_PANEL_ID = "data";

export const tabUx = z.enum(["split", "catalog", "query"]);

export const dataTab = z.object({
  tabId: z.string(),
  panelId: z.string(),
  title: z.string(),
  workspaceId: z.string().optional(),
  ownerAgentId: z.string().optional(),
  connectionId: z.string().optional(),
  dsnId: z.string().optional(),
  database: z.string().optional(),
  schema: z.string().optional(),
  sql: z.string(),
  ux: tabUx,
  archivedAt: z.string().optional(),
  updatedAt: z.string(),
});

export const bindTab = defineRpc({
  name: "warehouse.tab.bind",
  input: z.object({
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    tabId: z.string().optional(),
  }),
  output: z.object({
    tab: dataTab,
    tabs: z.array(dataTab),
  }),
});

export const listTabs = defineRpc({
  name: "warehouse.tab.list",
  input: z.object({ workspaceId: z.string().optional() }),
  output: z.object({ tabs: z.array(dataTab), selectedId: z.string().optional() }),
});

export const getTab = defineRpc({
  name: "warehouse.tab.get",
  input: z.object({ tabId: z.string() }),
  output: dataTab,
});

export const createTab = defineRpc({
  name: "warehouse.tab.create",
  input: z.object({
    workspaceId: z.string().optional(),
    title: z.string().optional(),
    connectionId: z.string().optional(),
    dsnId: z.string().optional(),
    sql: z.string().optional(),
    ux: tabUx.optional(),
  }),
  output: dataTab,
});

export const patchTab = defineRpc({
  name: "warehouse.tab.patch",
  input: z.object({
    tabId: z.string(),
    title: z.string().optional(),
    ownerAgentId: z.string().nullable().optional(),
    connectionId: z.string().nullable().optional(),
    dsnId: z.string().nullable().optional(),
    database: z.string().nullable().optional(),
    schema: z.string().nullable().optional(),
    sql: z.string().optional(),
    ux: tabUx.optional(),
  }),
  output: dataTab,
});

export const assignTab = defineRpc({
  name: "warehouse.tab.assign",
  input: z.object({
    tabId: z.string(),
    agentId: z.string(),
  }),
  output: dataTab,
});

export const closeTab = defineRpc({
  name: "warehouse.tab.close",
  input: z.object({ tabId: z.string() }),
  output: z.object({
    tabs: z.array(dataTab),
    tab: dataTab.nullable(),
  }),
});

export type TabUx = z.infer<typeof tabUx>;
export type DataTab = z.infer<typeof dataTab>;

export function tabLabel(tab: DataTab): string {
  if (tab.schema && tab.sql.includes(" from ")) {
    const match = /\bfrom\s+"?([\w.]+)"?\.?"?(\w+)"?/i.exec(tab.sql);
    if (match?.[2]) {
      return match[2];
    }
  }
  if (tab.title && tab.title !== "Data" && !/^Data \d+$/.test(tab.title)) {
    return tab.title;
  }
  return tab.tabId.slice(5, 11);
}

export function tabConnectionId(tab: Pick<DataTab, "connectionId" | "dsnId">): string | undefined {
  return tab.connectionId || tab.dsnId;
}

export function newTabId(): string {
  return `dtab-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
