import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface, WorkspaceSurface } from "./main.client";
import {
  admitPackHandler,
  listFilesHandler,
  loadCatalogHandler,
  loadFaceHandler,
  loadStatusHandler,
  openPackHandler,
  readFileHandler,
  setTabHandler,
  startViewer,
} from "./prim.server";
import {
  admitPack,
  listFiles,
  loadCatalog,
  loadFace,
  loadStatus,
  openPack,
  readFile,
  setTab,
} from "./prim.shared";
import { APP_NAME, PANEL_ID } from "./prim.store";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadCatalog, loadCatalogHandler);
  plugin.handle(openPack, openPackHandler);
  plugin.handle(setTab, setTabHandler);
  plugin.handle(admitPack, admitPackHandler);
  plugin.handle(loadStatus, loadStatusHandler);
  plugin.handle(listFiles, listFilesHandler);
  plugin.handle(loadFace, loadFaceHandler);
  plugin.handle(readFile, readFileHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: APP_NAME,
    icon: "Box",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-prim-desktop",
    title: `Open ${APP_NAME}`,
    icon: "Box",
    keywords: ["prim", "prims", "viewer", "pack", "memory"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addCommandCenterItem({
    id: "open-workspace-prim",
    title: `Open ${APP_NAME}`,
    icon: "Box",
    keywords: ["prim", "prims", "viewer", "pack"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });
  plugin.addWorkspacePanel({
    id: PANEL_ID,
    title: APP_NAME,
    icon: "Box",
    context: "workspace",
    Component: WorkspaceSurface,
  });
  let stop: (() => void) | undefined;
  void startViewer().then((close) => {
    stop = close;
  });
  return () => {
    stop?.();
  };
}
