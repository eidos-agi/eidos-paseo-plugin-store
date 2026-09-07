import type { PluginContext } from "@getpaseo/plugin";
import { dropPackHandler, loadBoardHandler, openHostHandler, selectPackHandler, setTabHandler } from "./board.server";
import { dropPack, loadBoard, openHost, selectPack, setTab } from "./board.shared";
import { APP_NAME, PANEL_ID } from "./board.store";
import { MainSurface, WorkspaceSurface } from "./main.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadBoard, loadBoardHandler);
  plugin.handle(selectPack, selectPackHandler);
  plugin.handle(setTab, setTabHandler);
  plugin.handle(openHost, openHostHandler);
  plugin.handle(dropPack, dropPackHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: APP_NAME,
    icon: "LayoutDashboard",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-primboard",
    title: `Open ${APP_NAME}`,
    icon: "LayoutDashboard",
    keywords: ["prim", "prims", "board", "pack", "memory", "catalog"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addCommandCenterItem({
    id: "open-workspace-primboard",
    title: `Open ${APP_NAME}`,
    icon: "LayoutDashboard",
    keywords: ["prim", "prims", "board", "pack", "memory"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });
  plugin.addWorkspacePanel({
    id: PANEL_ID,
    title: APP_NAME,
    icon: "LayoutDashboard",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: WorkspaceSurface,
  });
  return () => {};
}
