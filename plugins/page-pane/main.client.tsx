import type {
  PluginAgentPanelProps,
  PluginHostProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin";
import { useAgent, useRpc } from "@getpaseo/plugin";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { GroupView, PageView, Snapshot } from "./browser.model";
import { DEFAULT_GROUPS, groupPanelTitle } from "./browser.model";
import {
  groupBack,
  groupGo,
  groupPage,
  groupReload,
  groupSnapshot,
  linkAdd,
  linkRemove,
  viewSet,
} from "./browser.shared";

const START_URL = DEFAULT_GROUPS[0][0];
const THUMB_HEIGHT = { s: 120, m: 180, l: 260, xl: 360 } as const;

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function paneSrc(liveViewUrl: string): string {
  const url = new URL(liveViewUrl);
  url.searchParams.set("navbar", "false");
  return url.toString();
}

function popOut(liveViewUrl: string, name: string): boolean {
  const width = window.screen.availWidth;
  const height = window.screen.availHeight;
  return Boolean(window.open(liveViewUrl, name, `popup=1,width=${width},height=${height},left=0,top=0`));
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function pageKey(groupId: string, pageId: string): string {
  return `${groupId}:${pageId}`;
}

function groupsForWorkspace(groups: GroupView[], workspaceId?: string): GroupView[] {
  if (!workspaceId) {
    return groups;
  }
  return groups.filter((group) => !group.workspaceId || group.workspaceId === workspaceId);
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function nextPageUrl(group: GroupView | null): string {
  const have = new Set((group?.pages ?? []).map((page) => hostLabel(page.url)));
  const found = DEFAULT_GROUPS.flat().find((url) => !have.has(hostLabel(url)));
  return found ?? START_URL;
}

function pageTabLabel(page: PageView): string {
  if (page.title.trim()) {
    return page.title.trim();
  }
  try {
    return new URL(page.url).hostname.replace(/^www\./, "") || page.url;
  } catch {
    return page.url || "page";
  }
}

function LiveView({ src, title, style }: { src: string; title: string; style: object }) {
  return createElement("iframe", {
    src: paneSrc(src),
    title,
    referrerPolicy: "no-referrer",
    sandbox: "allow-same-origin allow-scripts",
    allow: "clipboard-read; clipboard-write",
    style,
  });
}

function AgentChip({ agentId, theme }: { agentId: string; theme: PluginHostProps["theme"] }) {
  const title = useAgent(agentId, (agent) => agent.title);
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
      {title || shortId(agentId)}
    </Text>
  );
}

function StripTab({
  label,
  selected,
  accessibilityLabel,
  onPress,
  styles,
}: {
  label: string;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  styles: Record<string, object>;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={selected ? [styles.tab, styles.tabOn] : styles.tab}
    >
      <Text numberOfLines={1} style={selected ? styles.tabOnText : styles.tabText}>
        {label}
      </Text>
    </Pressable>
  );
}

function AddressChrome({
  groupId,
  page,
  theme,
  styles,
  onGo,
  onBack,
  onReload,
}: {
  groupId: string;
  page: PageView;
  theme: PluginHostProps["theme"];
  styles: Record<string, object>;
  onGo: (groupId: string, pageId: string, url: string) => void;
  onBack: (groupId: string, pageId: string) => void;
  onReload: (groupId: string, pageId: string) => void;
}) {
  const [address, setAddress] = useState(page.url);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setAddress(page.url);
    }
  }, [page.url]);

  return (
    <View style={styles.chrome}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => onBack(groupId, page.id)}
        style={styles.iconButton}
      >
        <Text style={styles.iconText}>←</Text>
      </Pressable>
      <TextInput
        accessibilityLabel="URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onBlur={() => {
          focused.current = false;
        }}
        onChangeText={setAddress}
        onFocus={() => {
          focused.current = true;
        }}
        onSubmitEditing={() => {
          const next = normalizeUrl(address);
          if (next) {
            onGo(groupId, page.id, next);
          }
        }}
        placeholder="https://"
        placeholderTextColor={theme.colors.foregroundMuted}
        returnKeyType="go"
        style={styles.input}
        value={address}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reload"
        onPress={() => onReload(groupId, page.id)}
        style={styles.iconButton}
      >
        <Text style={styles.iconText}>↻</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pop out page"
        onPress={() => popOut(page.liveViewUrl, `bb-${page.id}`)}
        style={styles.iconButton}
      >
        <Text style={styles.iconText}>↗</Text>
      </Pressable>
    </View>
  );
}

function BrowserPane({
  theme,
  layout,
  workspaceId,
  agentId,
  groupSlot,
}: PluginHostProps & { workspaceId?: string; agentId?: string; groupSlot?: number }) {
  const takeSnapshot = useRpc(groupSnapshot);
  const addPage = useRpc(groupPage);
  const goGroup = useRpc(groupGo);
  const backGroup = useRpc(groupBack);
  const reloadGroup = useRpc(groupReload);
  const addLinkRpc = useRpc(linkAdd);
  const removeLinkRpc = useRpc(linkRemove);
  const setViewRpc = useRpc(viewSet);
  const [shot, setShot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [liveKey, setLiveKey] = useState<string | null>(null);

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      fallback: {
        flex: 1,
        padding: 16,
        gap: 8,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: 20 },
      detail: { color: theme.colors.foregroundMuted },
      tool: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 6,
        minHeight: 28,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.foregroundMuted,
      },
      toolLabel: { color: theme.colors.foregroundMuted, fontSize: 11, marginRight: 8 },
      strip: {
        flexDirection: "row" as const,
        alignItems: "stretch" as const,
        minHeight: 32,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.foregroundMuted,
      },
      stripScroll: { flexGrow: 0 },
      stripRow: { flexDirection: "row" as const, alignItems: "stretch" as const, flexGrow: 1 },
      tab: {
        justifyContent: "center" as const,
        paddingHorizontal: 12,
        maxWidth: 180,
        borderRightWidth: 1,
        borderRightColor: theme.colors.foregroundMuted,
      },
      tabOn: {
        backgroundColor: theme.colors.surface0,
        borderBottomWidth: 2,
        borderBottomColor: theme.colors.foreground,
      },
      tabText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tabOnText: { color: theme.colors.foreground, fontSize: 12 },
      addTab: {
        justifyContent: "center" as const,
        paddingHorizontal: 10,
      },
      links: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
        minHeight: 24,
      },
      mute: { color: theme.colors.foregroundMuted, fontSize: 11 },
      thumbs: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        padding: 8,
      },
      thumb: {
        flexDirection: "column" as const,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        overflow: "hidden" as const,
      },
      thumbFrame: { width: "100%" as const, overflow: "hidden" as const },
      thumbCaption: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        paddingHorizontal: 6,
        paddingVertical: 4,
      },
      chrome: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 6,
        minHeight: 28,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.foregroundMuted,
      },
      input: {
        flex: 1,
        height: 24,
        minHeight: 24,
        paddingHorizontal: 8,
        paddingVertical: 0,
        fontSize: 12,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
      },
      iconButton: {
        height: 24,
        paddingHorizontal: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      iconText: { color: theme.colors.foreground, fontSize: 12, lineHeight: 16 },
      error: { color: theme.colors.statusDanger, fontSize: 11, paddingHorizontal: 6, paddingVertical: 2 },
      frameWrap: { flex: 1, minHeight: 240 },
      frame: { width: "100%", height: "100%", borderWidth: 0, border: "none" },
    }),
    [theme],
  );

  const applyShot = useCallback((next: Snapshot) => {
    setShot(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyShot(
        await takeSnapshot({
          workspaceId,
          ...(groupSlot != null ? { slot: groupSlot } : {}),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cloud browser snapshot failed");
    }
  }, [applyShot, groupSlot, takeSnapshot, workspaceId]);

  const run = useCallback(
    async (work: () => Promise<Snapshot>) => {
      try {
        applyShot(await work());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Cloud browser request failed");
      }
    },
    [applyShot],
  );

  useEffect(() => {
    if (layout.platform !== "web") {
      return;
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [layout.platform, refresh]);

  const groups = groupsForWorkspace(shot?.groups ?? [], workspaceId).filter(
    (item) => groupSlot == null || item.slot === groupSlot,
  );
  const links = (shot?.links ?? []).filter((link) => !workspaceId || link.workspaceId === workspaceId);
  const view = shot?.view ?? { mode: "pages" as const, defaultSize: "m" as const };
  const group = groups.find((item) => item.groupId === selectedGroupId) ?? groups[0] ?? null;
  const page = group?.pages.find((item) => item.id === selectedPageId) ?? group?.pages[0] ?? null;
  const groupIndex = group ? groups.findIndex((item) => item.groupId === group.groupId) : -1;
  const linkedAgentIds = group
    ? links.filter((link) => link.groupId === group.groupId).map((link) => link.agentId)
    : [];
  const agentLinked = Boolean(
    agentId && group && links.some((link) => link.agentId === agentId && link.groupId === group.groupId),
  );

  useEffect(() => {
    if (!group) {
      return;
    }
    if (selectedGroupId !== group.groupId) {
      setSelectedGroupId(group.groupId);
    }
    if (page && selectedPageId !== page.id) {
      setSelectedPageId(page.id);
    }
  }, [group, page, selectedGroupId, selectedPageId]);

  useEffect(() => {
    if (view.mode !== "thumbs" || !group || !page) {
      return;
    }
    setLiveKey(pageKey(group.groupId, page.id));
  }, [group, page, view.mode]);

  if (layout.platform !== "web") {
    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>Paseo Browserbase</Text>
        <Text style={styles.detail}>
          This pane loads in the Paseo web client (app.paseo.sh). Native iOS/Android has no iframe host.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.tool}>
        <Text style={styles.toolLabel}>
          {groupSlot != null ? groupPanelTitle(groupSlot) : "Paseo Browserbase"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pages view"
          onPress={() => void run(() => setViewRpc({ mode: "pages" }))}
          style={styles.iconButton}
        >
          <Text style={styles.iconText}>{view.mode === "pages" ? "Pages" : "pages"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Thumbnails view"
          onPress={() => void run(() => setViewRpc({ mode: "thumbs" }))}
          style={styles.iconButton}
        >
          <Text style={styles.iconText}>{view.mode === "thumbs" ? "Thumbnails" : "thumbs"}</Text>
        </Pressable>
        {view.mode === "thumbs"
          ? (["s", "m", "l", "xl"] as const).map((size) => (
              <Pressable
                key={size}
                accessibilityRole="button"
                accessibilityLabel={`Thumbnail size ${size}`}
                onPress={() => void run(() => setViewRpc({ defaultSize: size }))}
                style={styles.iconButton}
              >
                <Text style={styles.iconText}>{size.toUpperCase()}</Text>
              </Pressable>
            ))
          : null}
      </View>
      {groupSlot == null ? (
      <View style={styles.strip} accessibilityRole="tablist">
        <ScrollView horizontal style={styles.stripScroll} contentContainerStyle={styles.stripRow}>
          {groups.map((item, index) => (
            <StripTab
              key={item.groupId}
              label={item.slot != null ? groupPanelTitle(item.slot) : `Group ${index + 1}`}
              selected={item.groupId === group?.groupId}
              accessibilityLabel={item.slot != null ? groupPanelTitle(item.slot) : `Group ${index + 1}`}
              onPress={() => {
                setSelectedGroupId(item.groupId);
                setSelectedPageId(item.pages[0]?.id ?? null);
              }}
              styles={styles}
            />
          ))}
        </ScrollView>
      </View>
      ) : null}
      {view.mode === "pages" && group ? (
        <View style={styles.strip} accessibilityRole="tablist">
          <ScrollView horizontal style={styles.stripScroll} contentContainerStyle={styles.stripRow}>
            {group.pages.map((item, index) => (
              <StripTab
                key={item.id}
                label={pageTabLabel(item)}
                selected={item.id === page?.id}
                accessibilityLabel={`Page ${index + 1}, ${pageTabLabel(item)}`}
                onPress={() => {
                  setSelectedPageId(item.id);
                  setLiveKey(pageKey(group.groupId, item.id));
                }}
                styles={styles}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`New page in Group ${groupIndex + 1}`}
              onPress={() =>
                void run(async () => {
                  const before = new Set(group.pages.map((item) => item.id));
                  const next = await addPage({ groupId: group.groupId, url: nextPageUrl(group) });
                  const updated =
                    groupsForWorkspace(next.groups, workspaceId).find((item) => item.groupId === group.groupId) ??
                    null;
                  const created = updated?.pages.find((item) => !before.has(item.id));
                  if (created) {
                    setSelectedPageId(created.id);
                    setLiveKey(pageKey(group.groupId, created.id));
                  }
                  return next;
                })
              }
              style={styles.addTab}
            >
              <Text style={styles.iconText}>+</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}
      {group && linkedAgentIds.length > 0 ? (
        <View style={styles.links}>
          <Text style={styles.mute}>linked agents</Text>
          {linkedAgentIds.map((id) => (
            <AgentChip key={id} agentId={id} theme={theme} />
          ))}
        </View>
      ) : null}
      {agentId && workspaceId && group ? (
        <View style={styles.links}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={agentLinked ? "Unlink this agent from this group" : "Link this agent to this group"}
            onPress={() =>
              void run(() =>
                (agentLinked ? removeLinkRpc : addLinkRpc)({
                  workspaceId,
                  agentId,
                  groupId: group.groupId,
                }),
              )
            }
            style={styles.iconButton}
          >
            <Text style={styles.iconText}>{agentLinked ? "unlink agent" : "link this agent"}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {view.mode === "thumbs" ? (
        <ScrollView>
          <View style={styles.thumbs}>
            {groups.flatMap((item, groupIndex) =>
              item.pages.map((pageItem, pageIndex) => {
                const height = THUMB_HEIGHT[pageItem.size ?? view.defaultSize];
                const frameHeight = Math.max(80, height - 24);
                const label =
                  groupSlot != null
                    ? pageTabLabel(pageItem)
                    : `${item.slot != null ? groupPanelTitle(item.slot) : `Group ${groupIndex + 1}`} · ${pageTabLabel(pageItem)}`;
                return (
                  <Pressable
                    key={pageKey(item.groupId, pageItem.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Thumbnail ${pageIndex + 1} in Group ${groupIndex + 1}, ${pageTabLabel(pageItem)}`}
                    onPress={() => {
                      setSelectedGroupId(item.groupId);
                      setSelectedPageId(pageItem.id);
                      setLiveKey(pageKey(item.groupId, pageItem.id));
                    }}
                    style={[styles.thumb, { height, width: height * 1.4 }]}
                  >
                    <View style={[styles.thumbFrame, { height: frameHeight }]}>
                      <LiveView
                        src={pageItem.liveViewUrl}
                        title={label}
                        style={{ ...styles.frame, height: frameHeight, pointerEvents: "none" }}
                      />
                    </View>
                    <Text numberOfLines={1} style={styles.thumbCaption}>
                      {label}
                    </Text>
                  </Pressable>
                );
              }),
            )}
          </View>
        </ScrollView>
      ) : page && group ? (
        <>
          <AddressChrome
            groupId={group.groupId}
            page={page}
            theme={theme}
            styles={styles}
            onGo={(id, pageId, url) => void run(() => goGroup({ groupId: id, pageId, url }))}
            onBack={(id, pageId) => void run(() => backGroup({ groupId: id, pageId }))}
            onReload={(id, pageId) => void run(() => reloadGroup({ groupId: id, pageId }))}
          />
          <View style={styles.frameWrap}>
            <LiveView src={page.liveViewUrl} title={pageTabLabel(page)} style={styles.frame} />
          </View>
        </>
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.detail}>
            {groupSlot != null
              ? `Starting ${groupPanelTitle(groupSlot)}…`
              : "Add a Browser Base Group from the workspace + menu, next to Files and Terminal."}
          </Text>
        </View>
      )}
    </View>
  );
}

export function MainSurface(props: PluginHostProps) {
  return <BrowserPane {...props} />;
}

export function WorkspaceGroup1(props: PluginWorkspacePanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} groupSlot={0} />;
}

export function WorkspaceGroup2(props: PluginWorkspacePanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} groupSlot={1} />;
}

export function WorkspaceGroup3(props: PluginWorkspacePanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} groupSlot={2} />;
}

export function WorkspaceGroup4(props: PluginWorkspacePanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} groupSlot={3} />;
}

export function WorkspaceGroup5(props: PluginWorkspacePanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} groupSlot={4} />;
}

export function WorkspaceGroup6(props: PluginWorkspacePanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} groupSlot={5} />;
}

export function AgentSurface(props: PluginAgentPanelProps) {
  return <BrowserPane {...props} workspaceId={props.workspaceId} agentId={props.agentId} />;
}
