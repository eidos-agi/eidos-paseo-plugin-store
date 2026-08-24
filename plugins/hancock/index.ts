import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface, WorkspaceSurface } from "./main.client";
import { loadTrayHandler, runSignHandler } from "./hancock.server";
import { loadTray, runSign } from "./hancock.shared";
import { APP_NAME, PANEL_ID } from "./hancock.store";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadTray, loadTrayHandler);
  plugin.handle(runSign, runSignHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: APP_NAME,
    icon: "Stamp",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-hancock",
    title: `Open ${APP_NAME}`,
    icon: "Stamp",
    keywords: ["hancock", "approve", "sign", "deny", "skip"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addCommandCenterItem({
    id: "open-workspace-hancock",
    title: `Open ${APP_NAME}`,
    icon: "Stamp",
    keywords: ["hancock", "approve", "sign"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });
  plugin.addWorkspacePanel({
    id: PANEL_ID,
    title: APP_NAME,
    icon: "Stamp",
    context: "workspace",
    Component: WorkspaceSurface,
  });
  return () => {};
}
