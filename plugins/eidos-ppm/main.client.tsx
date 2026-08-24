import { APP_NAME } from "./ppm.store";
import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  canRun,
  filterStore,
  primaryAction,
  statusLabel,
  type PluginAction,
  type StoreFilter,
} from "./ppm.logic";
import { loadCatalog, loadLogs, runAction, type Catalog, type LogLine, type PluginRow } from "./ppm.shared";

const EMPTY: Catalog = {
  host: "this Paseo",
  catalogRoot: "",
  registryPath: "",
  catalogUrl: "",
  publishedAt: null,
  plugins: [],
};

function shortPath(path: string): string {
  return path.replace(/\/Users\/[^/]+/, "~");
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const fetchCatalog = useRpc(loadCatalog);
  const act = useRpc(runAction);
  const fetchLogs = useRpc(loadLogs);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [filter, setFilter] = useState<StoreFilter>("all");
  const [openLogsId, setOpenLogsId] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; action: PluginAction } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      row: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, flexWrap: "wrap" as const },
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
      ghost: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      ghostOff: { opacity: 0.35 },
      ghostText: { color: theme.colors.foreground, fontSize: 13 },
      primary: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      store: { flex: 1 },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        padding: layout.compact ? 10 : 12,
        gap: 6,
        marginBottom: 8,
        backgroundColor: theme.colors.surface0,
      },
      name: { color: theme.colors.foreground, fontWeight: "700" as const, fontSize: 16 },
      blurb: { color: theme.colors.foregroundMuted, fontSize: 13 },
      mute: { color: theme.colors.foregroundMuted, fontSize: 12 },
      live: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" as const },
      error: { color: theme.colors.statusDanger },
      log: { color: theme.colors.foregroundMuted, fontFamily: "Menlo", fontSize: 11 },
      logErr: { color: theme.colors.statusDanger, fontFamily: "Menlo", fontSize: 11 },
      logs: { maxHeight: 140 },
    }),
    [theme, layout.compact],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await fetchCatalog({});
      setCatalog(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the store");
    }
  }, [fetchCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => filterStore(catalog.plugins, filter), [catalog.plugins, filter]);
  const storeCount = catalog.plugins.filter((plugin) => plugin.inRegistry).length;
  const installedCount = catalog.plugins.filter((plugin) => plugin.installed).length;
  const unlistedCount = catalog.plugins.filter((plugin) => !plugin.inRegistry).length;

  async function showLogs(id: string): Promise<void> {
    if (openLogsId === id) {
      setOpenLogsId(null);
      return;
    }
    setOpenLogsId(id);
    try {
      const next = await fetchLogs({ id });
      setLines(next.lines);
      setError(null);
    } catch (caught) {
      setLines([]);
      setError(caught instanceof Error ? caught.message : "Could not load logs");
    }
  }

  async function run(action: PluginAction, row: PluginRow): Promise<void> {
    if (
      (action === "uninstall" || action === "unregister") &&
      (confirm?.id !== row.id || confirm?.action !== action)
    ) {
      setConfirm({ id: row.id, action });
      return;
    }
    setBusyId(row.id);
    setConfirm(null);
    try {
      const next = await act({ id: row.id, action, path: row.path });
      setCatalog(next);
      setError(null);
      if (openLogsId === row.id && (row.installed || action === "install")) {
        const logs = await fetchLogs({ id: row.id });
        setLines(logs.lines);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} ${row.title}`);
    } finally {
      setBusyId(null);
    }
  }

  function actionLabel(action: PluginAction, row: PluginRow): string {
    if ((action === "uninstall" || action === "unregister") && confirm?.id === row.id && confirm.action === action) {
      return action === "unregister" ? "Confirm remove from store" : "Confirm remove config";
    }
    if (action === "register") {
      return "Add to store";
    }
    if (action === "unregister") {
      return "Remove from store";
    }
    if (action === "install") {
      return row.downloadUrl && !row.path ? "Install from GitHub" : "Add to this Paseo";
    }
    if (action === "update") {
      return row.publishedVersion ? `Update to ${row.publishedVersion}` : "Update";
    }
    if (action === "uninstall") {
      return "Remove config";
    }
    return action[0].toUpperCase() + action.slice(1);
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.sub}>
        {storeCount} in store · {installedCount} on this Paseo · {unlistedCount} unlisted.
        Registry {shortPath(catalog.registryPath) || "~/.paseo/eidos-plugin-store/registry.json"}.
        {catalog.catalogUrl ? ` Catalog ${catalog.catalogUrl}` : ""}
      </Text>
      <View style={styles.row}>
        {([
          ["all", "All"],
          ["store", "In store"],
          ["installed", "On this Paseo"],
          ["unlisted", "Unlisted"],
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh store"
          onPress={() => void refresh()}
          style={styles.ghost}
        >
          <Text style={styles.ghostText}>{busyId ? "…" : "Refresh"}</Text>
        </Pressable>
        {catalog.plugins.some((plugin) => plugin.self) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add published plugins from GitHub"
            onPress={() => {
              const self = catalog.plugins.find((plugin) => plugin.self);
              if (self) {
                void run("sync", self);
              }
            }}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>Sync catalog</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView style={styles.store}>
        {shown.length === 0 ? (
          <Text style={styles.sub}>Nothing on this shelf.</Text>
        ) : (
          shown.map((row) => {
            const label = statusLabel(row);
            const main = primaryAction(row);
            const busy = busyId === row.id;
            const extras: PluginAction[] = (
              ["register", "reload", "enable", "disable", "install", "update", "uninstall", "unregister"] as const
            ).filter((action) => action !== main && canRun(row, action));
            return (
              <View key={`${row.id}:${row.path}`} style={styles.card}>
                <Text style={styles.name}>
                  {row.status === "running" ? "●" : "○"} {row.title}
                  {row.self ? " · this store" : ""}
                </Text>
                {row.description ? <Text style={styles.blurb}>{row.description}</Text> : null}
                <Text style={row.status === "running" ? styles.live : styles.mute}>
                  {label} · {row.id}
                  {row.version ? ` · v${row.version}` : ""}
                  {row.updateAvailable && row.publishedVersion ? ` → ${row.publishedVersion}` : ""}
                  {row.path ? ` · ${shortPath(row.path)}` : row.downloadUrl ? " · GitHub latest" : ""}
                </Text>
                <View style={styles.row}>
                  {main ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${actionLabel(main, row)} ${row.title}`}
                      disabled={busy}
                      onPress={() => void run(main, row)}
                      style={[styles.primary, busy ? styles.ghostOff : null]}
                    >
                      <Text style={styles.primaryText}>{busy ? "…" : actionLabel(main, row)}</Text>
                    </Pressable>
                  ) : null}
                  {extras.map((action) => (
                    <Pressable
                      key={action}
                      accessibilityRole="button"
                      accessibilityLabel={`${actionLabel(action, row)} ${row.title}`}
                      disabled={busy}
                      onPress={() => void run(action, row)}
                      style={[styles.ghost, busy ? styles.ghostOff : null]}
                    >
                      <Text style={styles.ghostText}>{actionLabel(action, row)}</Text>
                    </Pressable>
                  ))}
                  {row.installed ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${openLogsId === row.id ? "Hide" : "Show"} logs for ${row.title}`}
                      onPress={() => void showLogs(row.id)}
                      style={styles.ghost}
                    >
                      <Text style={styles.ghostText}>{openLogsId === row.id ? "Hide logs" : "Logs"}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {openLogsId === row.id ? (
                  <ScrollView style={styles.logs}>
                    {lines.length === 0 ? (
                      <Text style={styles.sub}>No log lines.</Text>
                    ) : (
                      lines.map((line, index) => (
                        <Text
                          key={`${line.timestamp}:${index}`}
                          style={line.stream === "stderr" ? styles.logErr : styles.log}
                        >
                          {line.message}
                        </Text>
                      ))
                    )}
                  </ScrollView>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
