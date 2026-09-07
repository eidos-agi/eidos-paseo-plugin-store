import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  EXPLORE_TABS,
  axCard,
  axColumn,
  hitColumn,
  packKind,
  type BoardColumnId,
  type Rect,
} from "./board.logic";
import { dropPack, loadBoard, openHost, selectPack, setTab, type Board, type PackCard } from "./board.shared";
import { APP_NAME } from "./board.store";

const EMPTY: Board = {
  host: APP_NAME,
  libraryPath: "",
  sessionPath: "",
  selectedId: null,
  tab: "face",
  viewerUrl: "",
  face: "",
  files: [],
  hop: "prim-desktop",
  columns: [
    { id: "memory", title: "Memory", packs: [] },
    { id: "demo", title: "Demo", packs: [] },
    { id: "docs", title: "Docs", packs: [] },
    { id: "brand", title: "Brand", packs: [] },
  ],
};

function LiveView({ src, title, style }: { src: string; title: string; style: object }) {
  return createElement("iframe", {
    src,
    title,
    referrerPolicy: "no-referrer",
    sandbox: "allow-same-origin allow-scripts",
    allow: "autoplay; clipboard-read; clipboard-write",
    style,
  });
}

function Desk({ theme, layout }: Pick<PluginSurfaceProps, "theme" | "layout">) {
  const fetchBoard = useRpc(loadBoard);
  const select = useRpc(selectPack);
  const changeTab = useRpc(setTab);
  const launchHost = useRpc(openHost);
  const place = useRpc(dropPack);
  const frames = useRef<Partial<Record<BoardColumnId, Rect>>>({});
  const colNodes = useRef<Partial<Record<BoardColumnId, View | null>>>({});
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = layout.compact ? 12 : 16;
  const gap = layout.compact ? 8 : 10;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: pad,
        gap,
        backgroundColor: theme.colors.surface0,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 18 : 22,
        fontWeight: "600" as const,
      },
      sub: { color: theme.colors.foregroundMuted, fontSize: 13 },
      row: {
        flexDirection: "row" as const,
        gap: 8,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
      },
      ghost: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      ghostOn: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      ghostText: { color: theme.colors.foreground, fontSize: 13 },
      ghostTextOn: { color: theme.colors.accentForeground, fontSize: 13 },
      error: { color: theme.colors.statusDanger },
      split: {
        flex: 1,
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        gap,
        minHeight: 0,
      },
      board: {
        width: layout.compact ? ("100%" as const) : 300,
        maxHeight: layout.compact ? 220 : undefined,
        minHeight: 0,
      },
      columns: {
        flex: 1,
        flexDirection: layout.compact ? ("row" as const) : ("column" as const),
        gap,
        minHeight: 0,
      },
      column: {
        flex: 1,
        minWidth: layout.compact ? 140 : undefined,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        padding: 10,
        backgroundColor: theme.colors.surface1,
        gap: 6,
        minHeight: 0,
      },
      columnTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      empty: { color: theme.colors.foregroundMuted, fontSize: 12 },
      card: {
        paddingVertical: 7,
        paddingHorizontal: 8,
        borderRadius: 8,
        gap: 2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginBottom: 6,
      },
      cardOn: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      name: { color: theme.colors.foreground, fontWeight: "600" as const, fontSize: 13 },
      nameOn: { color: theme.colors.accentForeground, fontWeight: "600" as const, fontSize: 13 },
      mute: { color: theme.colors.foregroundMuted, fontSize: 11 },
      muteOn: { color: theme.colors.accentForeground, fontSize: 11, opacity: 0.85 },
      stage: {
        flex: 1,
        minHeight: layout.compact ? 240 : 280,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        overflow: "hidden" as const,
        backgroundColor: theme.colors.surface0,
      },
      iframe: { width: "100%", height: "100%", borderWidth: 0, backgroundColor: "#f4f3ef" },
      file: { color: theme.colors.foreground, fontSize: 12, paddingVertical: 3 },
      face: { color: theme.colors.foreground, fontSize: 13, fontFamily: "Menlo" },
    }),
    [theme, layout.compact, pad, gap],
  );

  const refresh = useCallback(async () => {
    try {
      setBoard(await fetchBoard({}));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Primboard");
    }
  }, [fetchBoard]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = board.columns.flatMap((column) => column.packs).find((pack) => pack.id === board.selectedId);

  async function run(work: () => Promise<Board>): Promise<void> {
    setBusy(true);
    try {
      setBoard(await work());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open pack");
    } finally {
      setBusy(false);
    }
  }

  function pick(pack: PackCard): void {
    void run(() => select({ id: pack.id }));
  }

  function rememberColumn(id: BoardColumnId, node: View | null): void {
    if (node) {
      colNodes.current[id] = node;
    }
    colNodes.current[id]?.measureInWindow((x, y, width, height) => {
      frames.current[id] = { x, y, width, height };
    });
  }

  function releaseCard(pack: PackCard, start: { x: number; y: number } | null, pageX: number, pageY: number): void {
    if (!start) {
      pick(pack);
      return;
    }
    const dx = pageX - start.x;
    const dy = pageY - start.y;
    if (dx * dx + dy * dy < 64) {
      pick(pack);
      return;
    }
    const column = hitColumn(pageX, pageY, frames.current);
    if (!column) {
      return;
    }
    void run(() => place({ id: pack.id, column }));
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{selected ? selected.title : APP_NAME}</Text>
      <Text style={styles.sub}>
        {selected
          ? `${packKind(selected)} · ${selected.path.replace(/\/Users\/[^/]+/, "~")}`
          : "Open a pack on the board. The stage is the pack."}
      </Text>
      <View style={styles.row}>
        {EXPLORE_TABS.map((tab) => {
          const on = board.tab === tab;
          return (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityLabel={`Show ${tab}`}
              onPress={() => void run(() => changeTab({ tab }))}
              style={[styles.ghost, on ? styles.ghostOn : null]}
            >
              <Text style={on ? styles.ghostTextOn : styles.ghostText}>{tab}</Text>
            </Pressable>
          );
        })}
        {selected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${selected.title} in Prims Desktop`}
            onPress={() => void run(() => launchHost({ id: selected.id }))}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>Open in Prims Desktop</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh board"
          onPress={() => void refresh()}
          style={styles.ghost}
        >
          <Text style={styles.ghostText}>{busy ? "…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.split}>
        <View style={styles.board}>
          <View style={styles.columns}>
            {board.columns.map((column) => (
              <View
                key={column.id}
                testID={axColumn(column.id)}
                nativeID={axColumn(column.id)}
                accessibilityLabel={axColumn(column.id)}
                ref={(node) => rememberColumn(column.id, node)}
                onLayout={() => rememberColumn(column.id, colNodes.current[column.id] ?? null)}
                style={styles.column}
              >
                <Text style={styles.columnTitle}>
                  {column.title} · {column.packs.length}
                </Text>
                <ScrollView>
                  {column.packs.length === 0 ? (
                    <Text style={styles.empty}>Empty.</Text>
                  ) : (
                    column.packs.map((pack) => {
                      const on = pack.id === board.selectedId;
                      return (
                        <View
                          key={pack.id}
                          testID={axCard(pack.id)}
                          nativeID={axCard(pack.id)}
                          accessibilityRole="button"
                          accessibilityLabel={axCard(pack.id)}
                          onStartShouldSetResponder={() => true}
                          onMoveShouldSetResponder={() => true}
                          onResponderGrant={(event) => {
                            dragStart.current = {
                              id: pack.id,
                              x: event.nativeEvent.pageX,
                              y: event.nativeEvent.pageY,
                            };
                          }}
                          onResponderRelease={(event) => {
                            const start = dragStart.current?.id === pack.id ? dragStart.current : null;
                            dragStart.current = null;
                            releaseCard(pack, start, event.nativeEvent.pageX, event.nativeEvent.pageY);
                          }}
                          style={[styles.card, on ? styles.cardOn : null]}
                        >
                          <Text style={on ? styles.nameOn : styles.name}>{pack.title}</Text>
                          <Text style={on ? styles.muteOn : styles.mute}>{packKind(pack)}</Text>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.stage}>
          {board.tab === "files" && selected ? (
            <ScrollView style={{ flex: 1, padding: 14 }}>
              {board.files.length === 0 ? (
                <Text style={styles.sub}>No files in this pack.</Text>
              ) : (
                board.files.map((file) => (
                  <Text key={file} style={styles.file}>
                    {file}
                  </Text>
                ))
              )}
            </ScrollView>
          ) : board.viewerUrl && board.tab !== "files" ? (
            <LiveView src={board.viewerUrl} title={selected?.title || "Prim"} style={styles.iframe} />
          ) : selected ? (
            <ScrollView style={{ flex: 1, padding: 14 }}>
              <Text style={styles.face}>{board.face || "This pack has no face yet."}</Text>
            </ScrollView>
          ) : (
            <View style={{ flex: 1, padding: 16, justifyContent: "center", gap: 8 }}>
              <Text style={styles.title}>Pick a pack</Text>
              <Text style={styles.sub}>Face, play, and files open here. Prims Desktop is the document host if you want the Mac window.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export function MainSurface(props: PluginSurfaceProps) {
  return <Desk theme={props.theme} layout={props.layout} />;
}

export function WorkspaceSurface(props: PluginWorkspacePanelProps) {
  return <Desk theme={props.theme} layout={props.layout} />;
}
