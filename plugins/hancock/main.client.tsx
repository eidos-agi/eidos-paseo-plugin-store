import { APP_NAME } from "./hancock.store";
import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { canSign, shortCommand, type HancockAction, type HancockFilter } from "./hancock.logic";
import { loadTray, runSign, type RequestRow, type Tray } from "./hancock.shared";

const EMPTY: Tray = {
  host: APP_NAME,
  binary: "",
  version: "",
  statusLine: "",
  filter: "pending",
  pending: 0,
  requests: [],
  detailId: null,
  detail: "",
  error: null,
};

function shortPath(path: string): string {
  return path.replace(/\/Users\/[^/]+/, "~");
}

function Desk({ theme, layout }: Pick<PluginSurfaceProps, "theme" | "layout">) {
  const fetchTray = useRpc(loadTray);
  const sign = useRpc(runSign);
  const [tray, setTray] = useState<Tray>(EMPTY);
  const [filter, setFilter] = useState<HancockFilter>("pending");
  const [confirm, setConfirm] = useState<{ id: string; action: HancockAction } | null>(null);
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
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
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
      danger: {
        borderWidth: 1,
        borderColor: theme.colors.statusDanger,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      dangerText: { color: theme.colors.statusDanger, fontSize: 13 },
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
      name: { color: theme.colors.foreground, fontWeight: "700" as const, fontSize: 15 },
      mute: { color: theme.colors.foregroundMuted, fontSize: 12 },
      live: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" as const },
      error: { color: theme.colors.statusDanger },
      log: { color: theme.colors.foregroundMuted, fontFamily: "Menlo", fontSize: 11 },
      logs: { maxHeight: 180 },
    }),
    [theme, layout.compact],
  );

  const refresh = useCallback(
    async (openId?: string) => {
      try {
        const next = await fetchTray({ filter, id: openId });
        setTray(next);
        setError(next.error);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load Hancock");
      }
    },
    [fetchTray, filter],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: HancockAction, row: RequestRow): Promise<void> {
    if (confirm?.id !== row.id || confirm.action !== action) {
      setConfirm({ id: row.id, action });
      return;
    }
    setBusyId(row.id);
    setConfirm(null);
    try {
      const next = await sign({ id: row.id, action, filter });
      setTray(next);
      setError(next.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} ${row.id}`);
    } finally {
      setBusyId(null);
    }
  }

  function actionLabel(action: HancockAction, row: RequestRow): string {
    if (confirm?.id === row.id && confirm.action === action) {
      return `Confirm ${action}`;
    }
    return action[0].toUpperCase() + action.slice(1);
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.sub}>
        {tray.pending} pending · {tray.statusLine || "signing desk"}
        {tray.version ? ` · ${tray.version}` : ""}
      </Text>
      <View style={styles.row}>
        {(["pending", "all"] as const).map((id) => {
          const on = filter === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={id === "pending" ? "Pending tray" : "All requests"}
              onPress={() => setFilter(id)}
              style={[styles.toggle, on ? styles.toggleOn : null]}
            >
              <Text style={on ? styles.toggleTextOn : styles.toggleText}>
                {id === "pending" ? "Pending" : "History"}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Hancock tray"
          onPress={() => void refresh(tray.detailId ?? undefined)}
          style={styles.ghost}
        >
          <Text style={styles.ghostText}>{busyId ? "…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView style={styles.store}>
        {tray.requests.length === 0 ? (
          <Text style={styles.sub}>Nothing in this tray. Agents queue with `hancock add`; you sign here.</Text>
        ) : (
          tray.requests.map((row) => {
            const busy = busyId === row.id;
            const pending = canSign(row, "approve");
            return (
              <View key={row.id} style={styles.card}>
                <Text style={styles.name}>$ {shortCommand(row.command)}</Text>
                <Text style={pending ? styles.live : styles.mute}>
                  {row.status || "pending"}
                  {row.risk ? ` · ${row.risk}` : ""}
                  {row.cwd ? ` · ${shortPath(row.cwd)}` : ""}
                  {` · ${row.id}`}
                </Text>
                {row.reason ? <Text style={styles.sub}>{row.reason}</Text> : null}
                <View style={styles.row}>
                  {pending
                    ? (["approve", "deny", "skip"] as const).map((action) => (
                        <Pressable
                          key={action}
                          accessibilityRole="button"
                          accessibilityLabel={`${actionLabel(action, row)} ${row.id}`}
                          disabled={busy}
                          onPress={() => void run(action, row)}
                          style={[
                            action === "approve" ? styles.primary : action === "deny" ? styles.danger : styles.ghost,
                            busy ? styles.ghostOff : null,
                          ]}
                        >
                          <Text
                            style={
                              action === "approve"
                                ? styles.primaryText
                                : action === "deny"
                                  ? styles.dangerText
                                  : styles.ghostText
                            }
                          >
                            {busy ? "…" : actionLabel(action, row)}
                          </Text>
                        </Pressable>
                      ))
                    : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${tray.detailId === row.id ? "Hide" : "Show"} ${row.id}`}
                    onPress={() => void refresh(tray.detailId === row.id ? undefined : row.id)}
                    style={styles.ghost}
                  >
                    <Text style={styles.ghostText}>{tray.detailId === row.id ? "Hide" : "Show"}</Text>
                  </Pressable>
                </View>
                {tray.detailId === row.id && tray.detail ? (
                  <ScrollView style={styles.logs}>
                    {tray.detail.split("\n").map((line, index) => (
                      <Text key={`${row.id}:${index}`} style={styles.log}>
                        {line}
                      </Text>
                    ))}
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

export function MainSurface(props: PluginSurfaceProps) {
  return <Desk theme={props.theme} layout={props.layout} />;
}

export function WorkspaceSurface(props: PluginWorkspacePanelProps) {
  return <Desk theme={props.theme} layout={props.layout} />;
}
