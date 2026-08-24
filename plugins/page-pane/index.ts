import type { PluginContext } from "@getpaseo/plugin";
import {
  addLink,
  addPage,
  back,
  go,
  reload,
  removeLink,
  setView,
  start,
  takeSnapshot,
} from "./browser.server";
import {
  groupBack,
  groupGo,
  groupPage,
  groupReload,
  groupSnapshot,
  groupStart,
  linkAdd,
  linkRemove,
  viewSet,
} from "./browser.shared";
import {
  AgentSurface,
  MainSurface,
  WorkspaceGroup1,
  WorkspaceGroup2,
  WorkspaceGroup3,
  WorkspaceGroup4,
  WorkspaceGroup5,
  WorkspaceGroup6,
} from "./main.client";
import { groupPanelId, groupPanelTitle } from "./browser.model";

export default function contribute(plugin: PluginContext) {
  plugin.handle(groupSnapshot, takeSnapshot);
  plugin.handle(groupStart, start);
  plugin.handle(groupPage, addPage);
  plugin.handle(groupGo, go);
  plugin.handle(groupBack, back);
  plugin.handle(groupReload, reload);
  plugin.handle(linkAdd, addLink);
  plugin.handle(linkRemove, removeLink);
  plugin.handle(viewSet, setView);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "Paseo Browserbase",
    icon: "Globe",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-page",
    title: "Open Paseo Browserbase",
    icon: "Globe",
    keywords: ["browser", "browserbase", "group", "page"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addCommandCenterItem({
    id: "open-workspace-browserbase",
    title: "Open Browser Base Group 1",
    icon: "Globe",
    keywords: ["browser", "browserbase", "group"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(groupPanelId(0));
    },
  });
  plugin.addCommandCenterItem({
    id: "open-agent-browserbase",
    title: "Open Paseo Browserbase",
    icon: "Globe",
    keywords: ["browser", "browserbase", "group"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("browserbase-agent");
    },
  });
  plugin.addWorkspacePanel({
    id: groupPanelId(0),
    title: groupPanelTitle(0),
    icon: "Globe",
    context: "workspace",
    Component: WorkspaceGroup1,
  });
  plugin.addWorkspacePanel({
    id: groupPanelId(1),
    title: groupPanelTitle(1),
    icon: "Globe",
    context: "workspace",
    Component: WorkspaceGroup2,
  });
  plugin.addWorkspacePanel({
    id: groupPanelId(2),
    title: groupPanelTitle(2),
    icon: "Globe",
    context: "workspace",
    Component: WorkspaceGroup3,
  });
  plugin.addWorkspacePanel({
    id: groupPanelId(3),
    title: groupPanelTitle(3),
    icon: "Globe",
    context: "workspace",
    Component: WorkspaceGroup4,
  });
  plugin.addWorkspacePanel({
    id: groupPanelId(4),
    title: groupPanelTitle(4),
    icon: "Globe",
    context: "workspace",
    Component: WorkspaceGroup5,
  });
  plugin.addWorkspacePanel({
    id: groupPanelId(5),
    title: groupPanelTitle(5),
    icon: "Globe",
    context: "workspace",
    Component: WorkspaceGroup6,
  });
  plugin.addWorkspacePanel({
    id: "browserbase-agent",
    title: "Paseo Browserbase",
    icon: "Globe",
    context: "agent",
    Component: AgentSurface,
  });
  return () => {};
}
