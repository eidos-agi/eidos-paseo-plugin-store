import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";
import { loadCatalogHandler, loadLogsHandler, runActionHandler } from "./ppm.server";
import { loadCatalog, loadLogs, runAction } from "./ppm.shared";
import { APP_NAME } from "./ppm.store";

export default function contribute(plugin: PluginContext) {
  plugin.handle(loadCatalog, loadCatalogHandler);
  plugin.handle(runAction, runActionHandler);
  plugin.handle(loadLogs, loadLogsHandler);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: APP_NAME,
    icon: "Blocks",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-ppm",
    title: `Open ${APP_NAME}`,
    icon: "Blocks",
    keywords: ["plugin", "ppm", "eidos", "paseo", "store", "reload"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  return () => {};
}
