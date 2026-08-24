import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { buildDeskRows, countLive, defaultOpenKeys, statusLabel, type Filter } from "./desk.logic";
import { loadCatalog, openChat, stampTenants, type Catalog } from "./tree.shared";

const EMPTY: Catalog = { chats: [], folders: [], workspaces: [], projects: [] };

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const fetchCatalog = useRpc(loadCatalog);
  const open = useRpc(openChat);
  const stamp = useRpc(stampTenants);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stampNote, setStampNote] = useState<string | null>(null);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 12 : 18,
        gap: layout.compact ? 8 : 10,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 18 : 22,
        fontWeight: "600" as const,
      },
      sub: { color: theme.colors.foregroundMuted, fontSize: 13 },
      row: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const },
      toggle: {
        flex: 1,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingVertical: 8,
        alignItems: "center" as const,
      },
      toggleOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      toggleText: { color: theme.colors.foreground },
      toggleTextOn: { color: theme.colors.accentForeground },
      input: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        color: theme.colors.foreground,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
      },
      ghost: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
      ghostText: { color: theme.colors.foreground },
      tree: { flex: 1 },
      item: { paddingVertical: 7, paddingRight: 8, borderRadius: 6 },
      itemOn: { backgroundColor: theme.colors.accent },
      tenantText: { color: theme.colors.foreground, fontWeight: "700" as const, fontSize: 15 },
      productText: { color: theme.colors.foreground, fontWeight: "600" as const },
      chatText: { color: theme.colors.foreground },
      chatQuiet: { color: theme.colors.foregroundMuted },
      mute: { color: theme.colors.foregroundMuted, fontSize: 12 },
      muteOn: { color: theme.colors.accentForeground, fontSize: 12 },
      live: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" as const },
      error: { color: theme.colors.statusDanger },
    }),
    [theme, layout.compact],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await fetchCatalog({});
      setCatalog(next);
      if (!seeded.current) {
        setExpanded(new Set(defaultOpenKeys(next)));
        seeded.current = true;
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Volta");
    } finally {
      setBusy(false);
    }
  }, [fetchCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(
    () => buildDeskRows(catalog, filter, query, expanded),
    [catalog, filter, query, expanded],
  );
  const liveCount = useMemo(() => countLive(catalog), [catalog]);
  const selected = catalog.chats.find((chat) => chat.id === selectedId) ?? null;

  useEffect(() => {
    if (filter !== "live") {
      return;
    }
    setExpanded((current) => {
      const next = new Set(current);
      for (const key of defaultOpenKeys(catalog)) {
        next.add(key);
      }
      return next;
    });
  }, [filter, catalog]);

  function toggle(key: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Volta</Text>
      <Text style={styles.sub}>
        {liveCount} live · tenant → product → chat. Quiet stays on the desk, dim.
      </Text>
      <View style={styles.row}>
        {([
          ["all", "All"],
          ["live", "Live"],
        ] as const).map(([id, label]) => {
          const on = filter === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                setFilter(id);
                if (id === "live") {
                  void refresh();
                }
              }}
              style={[styles.toggle, on ? styles.toggleOn : null]}
            >
              <Text style={on ? styles.toggleTextOn : styles.toggleText}>{label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          onPress={() => void refresh()}
          style={styles.ghost}
        >
          <Text style={styles.ghostText}>{busy ? "…" : "Refresh"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stamp tenant labels"
          onPress={() => {
            setBusy(true);
            void stamp({})
              .then((result) => {
                setStampNote(
                  `Tenant labels: ${result.updated} stamped, ${result.skipped} already set, ${result.failed} failed`,
                );
                return refresh();
              })
              .catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "Could not stamp tenant labels");
              })
              .finally(() => setBusy(false));
          }}
          style={styles.ghost}
        >
          <Text style={styles.ghostText}>Stamp tenants</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="Search"
        placeholder="Find a tenant, product, or chat"
        placeholderTextColor={theme.colors.foregroundMuted}
        value={query}
        onChangeText={setQuery}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {stampNote ? <Text style={styles.sub}>{stampNote}</Text> : null}
      {rows.length === 0 && !busy ? (
        <Text style={styles.sub}>
          {filter === "live" ? "Nothing live on the desk right now." : "No chats in this pile."}
        </Text>
      ) : null}
      <ScrollView style={styles.tree}>
        {rows.map((row) => {
          const pad = { paddingLeft: 8 + row.depth * 14 };
          if (row.kind === "tenant" || row.kind === "product") {
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={`${row.open ? "Collapse" : "Expand"} ${row.title}`}
                onPress={() => toggle(row.key)}
                style={[styles.item, pad]}
              >
                <Text style={row.kind === "tenant" ? styles.tenantText : styles.productText}>
                  {row.open ? "▾" : "▸"} {row.title}
                </Text>
                <Text style={styles.mute}>
                  {row.live ? `${row.live} live` : "quiet"}
                  {row.quiet ? ` · ${row.quiet} idle` : ""}
                </Text>
              </Pressable>
            );
          }
          const on = selectedId === row.id;
          return (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={`${row.title}, ${statusLabel(row.status)}`}
              onPress={() => setSelectedId(row.id)}
              onLongPress={() => {
                setSelectedId(row.id);
                void open({ agentId: row.id }).catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : "Could not open chat");
                });
              }}
              style={[styles.item, on ? styles.itemOn : null, pad]}
            >
              <Text
                style={on ? styles.toggleTextOn : row.live ? styles.chatText : styles.chatQuiet}
                numberOfLines={1}
              >
                {row.live ? "●" : "○"} {row.title}
              </Text>
              <Text style={on ? styles.muteOn : row.live ? styles.live : styles.mute}>
                {statusLabel(row.status)}
                {row.folder ? ` · ${row.folder}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {selected ? (
        <View style={styles.row}>
          <Text style={[styles.sub, { flex: 1 }]} numberOfLines={2}>
            {selected.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open selected chat"
            onPress={() =>
              void open({ agentId: selected.id }).catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "Could not open chat");
              })
            }
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>Open</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.sub}>Tap a chat to select it. Open jumps to that tab.</Text>
      )}
    </View>
  );
}
