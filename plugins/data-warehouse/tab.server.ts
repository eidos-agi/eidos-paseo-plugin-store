import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import {
  DATA_PANEL_ID,
  assignTab,
  bindTab,
  closeTab,
  createTab,
  getTab,
  listTabs,
  newTabId,
  patchTab,
  type DataTab,
} from "./tab.shared";

const STATE_DIR = join(homedir(), ".paseo/data-warehouse");
const TABS_PATH = join(STATE_DIR, "tabs.json");

type Store = { tabs: DataTab[]; selected: Record<string, string> };

function workspaceKey(workspaceId?: string): string {
  return workspaceId || "_";
}

function emptyTab(workspaceId?: string, title = "Query"): DataTab {
  const now = new Date().toISOString();
  return {
    tabId: newTabId(),
    panelId: DATA_PANEL_ID,
    title,
    workspaceId,
    sql: "select 1 as ok",
    ux: "split",
    updatedAt: now,
  };
}

function migrate(raw: unknown): Store {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tabs = Array.isArray(rec.tabs) ? rec.tabs : [];
  const selected =
    rec.selected && typeof rec.selected === "object" && !Array.isArray(rec.selected)
      ? (rec.selected as Record<string, string>)
      : {};
  const next: DataTab[] = [];
  for (const item of tabs) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const tab = item as DataTab;
    if (!tab.tabId) {
      continue;
    }
    const { dsnId: legacyDsnId, ...rest } = tab;
    next.push({
      ...rest,
      panelId: DATA_PANEL_ID,
      title: tab.title && !/^Data \d+$/.test(tab.title) ? tab.title : "Query",
      connectionId: tab.connectionId || legacyDsnId,
    });
  }
  return { tabs: next, selected };
}

function loadStore(): Store {
  if (!existsSync(TABS_PATH)) {
    return { tabs: [], selected: {} };
  }
  try {
    return migrate(JSON.parse(readFileSync(TABS_PATH, "utf8")));
  } catch {
    return { tabs: [], selected: {} };
  }
}

function saveStore(store: Store): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(TABS_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function sameWorkspace(tab: DataTab, workspaceId?: string): boolean {
  if (!workspaceId) {
    return !tab.workspaceId;
  }
  return tab.workspaceId === workspaceId;
}

function liveTabs(store: Store, workspaceId?: string): DataTab[] {
  return store.tabs.filter((item) => !item.archivedAt && sameWorkspace(item, workspaceId));
}

function requireTab(store: Store, tabId: string): DataTab {
  const tab = store.tabs.find((item) => item.tabId === tabId && !item.archivedAt);
  if (!tab) {
    throw new Error(`Unknown data tab ${tabId}`);
  }
  return tab;
}

function select(store: Store, workspaceId: string | undefined, tabId: string): void {
  store.selected[workspaceKey(workspaceId)] = tabId;
}

function selectedTab(store: Store, workspaceId?: string): DataTab | undefined {
  const tabs = liveTabs(store, workspaceId);
  const id = store.selected[workspaceKey(workspaceId)];
  return tabs.find((item) => item.tabId === id) ?? tabs[0];
}

export async function bindTabHandler(input: ZodOutput<typeof bindTab.input>): Promise<{ tab: DataTab; tabs: DataTab[] }> {
  const store = loadStore();
  if (input.tabId) {
    const tab = requireTab(store, input.tabId);
    select(store, input.workspaceId ?? tab.workspaceId, tab.tabId);
    saveStore(store);
    return { tab, tabs: liveTabs(store, input.workspaceId ?? tab.workspaceId) };
  }
  let tab = selectedTab(store, input.workspaceId);
  if (!tab) {
    tab = emptyTab(input.workspaceId);
    store.tabs.push(tab);
    select(store, input.workspaceId, tab.tabId);
  }
  if (input.agentId && !tab.ownerAgentId) {
    tab.ownerAgentId = input.agentId;
    tab.updatedAt = new Date().toISOString();
  }
  saveStore(store);
  return { tab, tabs: liveTabs(store, input.workspaceId) };
}

export async function listTabsHandler(input: ZodOutput<typeof listTabs.input>): Promise<{ tabs: DataTab[]; selectedId?: string }> {
  const store = loadStore();
  const tabs = liveTabs(store, input.workspaceId);
  return { tabs, selectedId: selectedTab(store, input.workspaceId)?.tabId };
}

export async function getTabHandler(input: ZodOutput<typeof getTab.input>): Promise<DataTab> {
  return requireTab(loadStore(), input.tabId);
}

export async function createTabHandler(input: ZodOutput<typeof createTab.input>): Promise<DataTab> {
  const store = loadStore();
  const tab = emptyTab(input.workspaceId, input.title);
  if (input.connectionId || input.dsnId) {
    tab.connectionId = input.connectionId || input.dsnId;
  }
  if (input.sql) {
    tab.sql = input.sql;
  }
  if (input.ux) {
    tab.ux = input.ux;
  }
  store.tabs.push(tab);
  select(store, input.workspaceId, tab.tabId);
  saveStore(store);
  return tab;
}

export async function patchTabHandler(input: ZodOutput<typeof patchTab.input>): Promise<DataTab> {
  const store = loadStore();
  const tab = requireTab(store, input.tabId);
  if (input.title !== undefined) {
    tab.title = input.title;
  }
  if (input.ownerAgentId !== undefined) {
    tab.ownerAgentId = input.ownerAgentId ?? undefined;
  }
  if (input.connectionId !== undefined) {
    tab.connectionId = input.connectionId ?? undefined;
  }
  if (input.dsnId !== undefined) {
    tab.connectionId = input.dsnId ?? tab.connectionId;
  }
  if (input.database !== undefined) {
    tab.database = input.database ?? undefined;
  }
  if (input.schema !== undefined) {
    tab.schema = input.schema ?? undefined;
  }
  if (input.sql !== undefined) {
    tab.sql = input.sql;
  }
  if (input.ux !== undefined) {
    tab.ux = input.ux;
  }
  tab.updatedAt = new Date().toISOString();
  saveStore(store);
  return tab;
}

export async function assignTabHandler(input: ZodOutput<typeof assignTab.input>): Promise<DataTab> {
  return patchTabHandler({ tabId: input.tabId, ownerAgentId: input.agentId });
}

export async function closeTabHandler(input: ZodOutput<typeof closeTab.input>): Promise<{ tabs: DataTab[]; tab: DataTab | null }> {
  const store = loadStore();
  const tab = requireTab(store, input.tabId);
  tab.archivedAt = new Date().toISOString();
  tab.updatedAt = tab.archivedAt;
  const remaining = liveTabs(store, tab.workspaceId);
  const next = remaining[0];
  if (next) {
    select(store, tab.workspaceId, next.tabId);
  } else {
    delete store.selected[workspaceKey(tab.workspaceId)];
  }
  saveStore(store);
  return { tabs: remaining, tab: next ?? null };
}
