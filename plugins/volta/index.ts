import type { PluginContext } from "@getpaseo/plugin";
import { FilePanel } from "./file.client";
import { MainSurface } from "./main.client";
import {
  createFolderHandler,
  fileChatHandler,
  loadCatalogHandler,
  openChatHandler,
  stampTenantsHandler,
} from "./tree.server";
import { createFolder, fileChat, loadCatalog, openChat, stampTenants } from "./tree.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadCatalog, loadCatalogHandler);
  plugin.handle(fileChat, fileChatHandler);
  plugin.handle(createFolder, createFolderHandler);
  plugin.handle(openChat, openChatHandler);
  plugin.handle(stampTenants, stampTenantsHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "Volta",
    icon: "Zap",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-volta",
    title: "Open Volta",
    icon: "Zap",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addCommandCenterItem({
    id: "stamp-tenants",
    title: "Stamp Volta tenant labels",
    icon: "Tags",
    context: "global",
    onSelect({ rpc }) {
      void rpc(stampTenants, {});
    },
  });
  plugin.addWorkspacePanel({
    id: "file",
    title: "Place in Volta",
    icon: "FolderInput",
    context: "agent",
    Component: FilePanel,
  });
  plugin.addCommandCenterItem({
    id: "file-chat",
    title: "Place this chat in Volta",
    icon: "FolderInput",
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("file");
    },
  });
  return () => {};
}
