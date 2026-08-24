import type { PluginContext } from "@getpaseo/plugin";
import { AgentSurface, MainSurface, WorkspaceSurface } from "./main.client";
import {
  assignTabHandler,
  bindTabHandler,
  closeTabHandler,
  createTabHandler,
  getTabHandler,
  listTabsHandler,
  patchTabHandler,
} from "./tab.server";
import {
  DATA_PANEL_ID,
  assignTab,
  bindTab,
  closeTab,
  createTab,
  getTab,
  listTabs,
  patchTab,
} from "./tab.shared";
import { browseCatalogHandler, loadSnapshotHandler, readSqlHandler, runQueryHandler } from "./warehouse.server";
import { browseCatalog, loadSnapshot, readSql, runQuery } from "./warehouse.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadSnapshot, loadSnapshotHandler);
  plugin.handle(readSql, readSqlHandler);
  plugin.handle(runQuery, runQueryHandler);
  plugin.handle(browseCatalog, browseCatalogHandler);
  plugin.handle(bindTab, bindTabHandler);
  plugin.handle(listTabs, listTabsHandler);
  plugin.handle(getTab, getTabHandler);
  plugin.handle(createTab, createTabHandler);
  plugin.handle(patchTab, patchTabHandler);
  plugin.handle(assignTab, assignTabHandler);
  plugin.handle(closeTab, closeTabHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "Data",
    icon: "Database",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-data",
    title: "Open Data",
    icon: "Database",
    keywords: ["sql", "warehouse", "database", "dsn", "connection", "dtab"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addCommandCenterItem({
    id: "new-workspace-data",
    title: "New query",
    icon: "Database",
    keywords: ["sql", "warehouse", "database", "dsn", "connection", "dtab", "new", "data"],
    context: "workspace",
    onSelect({ openPanel, rpc, workspace }) {
      void rpc(createTab, { workspaceId: workspace.id }).then(() => {
        openPanel(DATA_PANEL_ID);
      });
    },
  });
  plugin.addCommandCenterItem({
    id: "open-workspace-data",
    title: "Open Data",
    icon: "Database",
    keywords: ["sql", "warehouse", "database"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(DATA_PANEL_ID);
    },
  });
  plugin.addCommandCenterItem({
    id: "open-agent-data",
    title: "Open Data",
    icon: "Database",
    keywords: ["sql", "warehouse", "database", "dtab"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("data-agent");
    },
  });
  plugin.addWorkspacePanel({
    id: DATA_PANEL_ID,
    title: "Data",
    icon: "Database",
    context: "workspace",
    Component: WorkspaceSurface,
  });
  plugin.addWorkspacePanel({
    id: "data-agent",
    title: "Data",
    icon: "Database",
    context: "agent",
    Component: AgentSurface,
  });
  return () => {};
}
