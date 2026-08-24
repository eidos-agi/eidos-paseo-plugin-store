import { APP_NAME } from "./prim.store";
import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { filterPacks, type StoreFilter } from "./prim.logic";
import {
  admitPack,
  loadCatalog,
  openPack,
  type Catalog,
  type PackRow,
} from "./prim.shared";

const EMPTY: Catalog = {
  host: APP_NAME,
  libraryPath: "",
  queuePath: "",
  session: { openId: null, tab: "face", origin: "", viewerUrl: "" },
  packs: [],
};

function shortPath(path: string): string {
  return path.replace(/\/Users\/[^/]+/, "~");
}

function LiveView({ src, title, style }: { src: string; title: string; style: object }) {
  return createElement("iframe", {
    src,
    title,
    referrerPolicy: "no-referrer",
    sandbox: "allow-same-origin allow-scripts",
    allow: "clipboard-read; clipboard-write",
    style,
  });
}

function Desk({ theme, layout }: Pick<PluginSurfaceProps, "theme" | "layout">) {
  const fetchCatalog = useRpc(loadCatalog);
  const open = useRpc(openPack);
  const admit = useRpc(admitPack);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [filter, setFilter] = useState<StoreFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 10 : 14,
        gap: 8,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 18 : 22,
        fontWeight: "600" as const,
      },
      sub: { color: theme.colors.foregroundMuted, fontSize: 13 },
      row: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, flexWrap: "wrap" as const },
      split: { flex: 1, flexDirection: layout.compact ? ("column" as const) : ("row" as const), gap: 8, minHeight: 0 },
      rail: {
        width: 260,
        maxHeight: layout.compact ? 180 : undefined,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        padding: 8,
      },
      stage: {
        flex: 1,
        minHeight: 240,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        overflow: "hidden" as const,
        backgroundColor: theme.colors.surface0,
      },
      iframe: { width: "100%", height: "100%", borderWidth: 0, backgroundColor: "#f4f3ef" },
      toggle: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      toggleOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      toggleText: { color: theme.colors.foreground, fontSize: 13 },
      toggleTextOn: { color: theme.colors.accentForeground, fontSize: 13 },
      card: { paddingVertical: 7, paddingHorizontal: 6, borderRadius: 8, gap: 2 },
      cardOn: { backgroundColor: theme.colors.accent },
      name: { color: theme.colors.foreground, fontWeight: "600" as const, fontSize: 14 },
      nameOn: { color: theme.colors.accentForeground, fontWeight: "600" as const, fontSize: 14 },
      mute: { color: theme.colors.foregroundMuted, fontSize: 12 },
      muteOn: { color: theme.colors.accentForeground, fontSize: 12, opacity: 0.85 },
      ghost: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      ghostText: { color: theme.colors.foreground, fontSize: 13 },
      error: { color: theme.colors.statusDanger },
    }),
    [theme, layout.compact],
  );

  const refresh = useCallback(async () => {
    try {
      setCatalog(await fetchCatalog({}));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Prim Desktop");
    }
  }, [fetchCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => filterPacks(catalog.packs, filter), [catalog.packs, filter]);
  const memoryCount = catalog.packs.filter((pack) => pack.admitted).length;
  const demoCount = catalog.packs.filter((pack) => !pack.admitted).length;
  const openRow = catalog.packs.find((pack) => pack.id === catalog.session.openId);

  async function run(work: () => Promise<Catalog>): Promise<void> {
    setBusy(true);
    try {
      setCatalog(await work());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not control the prim");
    } finally {
      setBusy(false);
    }
  }

  function packLabel(row: PackRow): string {
    const kind = [row.profile, row.type].filter(Boolean).join(" · ");
    return kind || row.source;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.sub}>
        {memoryCount} in memory · {demoCount} on disk. The pack stays the file.
        Queue {shortPath(catalog.queuePath) || "~/.paseo/prim-desktop/queue"}.
      </Text>
      <View style={styles.row}>
        {([
          ["all", "All"],
          ["memory", "Memory"],
          ["demo", "On disk"],
        ] as const).map(([id, label]) => {
          const on = filter === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => setFilter(id)}
              style={[styles.toggle, on ? styles.toggleOn : null]}
            >
              <Text style={on ? styles.toggleTextOn : styles.toggleText}>{label}</Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh library" onPress={() => void refresh()} style={styles.ghost}>
          <Text style={styles.ghostText}>{busy ? "…" : "Refresh"}</Text>
        </Pressable>
        {openRow && !openRow.admitted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Admit ${openRow.title} to memory`}
            onPress={() => void run(() => admit({ id: openRow.id }))}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>Admit to memory</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.split}>
        <ScrollView style={styles.rail}>
          {shown.length === 0 ? (
            <Text style={styles.sub}>No packs on this shelf.</Text>
          ) : (
            shown.map((row) => {
              const on = row.id === catalog.session.openId;
              return (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${row.title}`}
                  onPress={() => void run(() => open({ id: row.id }))}
                  style={[styles.card, on ? styles.cardOn : null]}
                >
                  <Text style={on ? styles.nameOn : styles.name}>
                    {row.admitted ? "●" : "○"} {row.title}
                  </Text>
                  <Text style={on ? styles.muteOn : styles.mute}>{packLabel(row)}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
        <View style={styles.stage}>
          {catalog.session.viewerUrl ? (
            <LiveView
              key={`${catalog.session.openId}:${catalog.session.tab}:${catalog.session.viewerUrl}`}
              src={catalog.session.viewerUrl}
              title={openRow?.title || "Prim"}
              style={styles.iframe}
            />
          ) : (
            <View style={{ flex: 1, padding: 16, gap: 8, justifyContent: "center" }}>
              <Text style={styles.title}>Open a pack</Text>
              <Text style={styles.sub}>
                Memory is the gate. Open a prim from the rail. Agents control the open one
                through prim.open / prim.tab / prim.read, or by appending to the queue.
              </Text>
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
