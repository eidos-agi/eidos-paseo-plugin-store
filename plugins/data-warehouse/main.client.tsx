import type {
  PluginAgentPanelProps,
  PluginSurfaceProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { filterConnections, filterNodes, filterSqls, fileTypeLabel, previewCell, prettyCell, columnWidth, qualifyTable, singletonName, type Filter } from "./warehouse.logic";
import {
  assignTab,
  bindTab,
  closeTab,
  createTab,
  getTab,
  listTabs,
  patchTab,
  tabConnectionId,
  tabLabel,
  type DataTab,
  type TabUx,
} from "./tab.shared";
import {
  browseCatalog,
  loadSnapshot,
  readSql,
  runQuery,
  type BrowseNode,
  type DataConnection,
  type QueryResult,
  type Snapshot,
  type SqlFile,
} from "./warehouse.shared";

const EMPTY: Snapshot = { host: "this Paseo", connections: [], sqls: [] };
const DEFAULT_SQL = "select 1 as ok";

type Drill = {
  connectionId?: string;
  database?: string;
  schema?: string;
};

function DataDesk({
  theme,
  layout,
  workspaceId,
  agentId,
}: PluginSurfaceProps & { workspaceId?: string; agentId?: string }) {
  const fetchSnapshot = useRpc(loadSnapshot);
  const fetchSql = useRpc(readSql);
  const fetchBrowse = useRpc(browseCatalog);
  const query = useRpc(runQuery);
  const bind = useRpc(bindTab);
  const fetchTab = useRpc(getTab);
  const fetchTabs = useRpc(listTabs);
  const makeTab = useRpc(createTab);
  const dropTab = useRpc(closeTab);
  const saveTab = useRpc(patchTab);
  const claimTab = useRpc(assignTab);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [filter, setFilter] = useState<Filter>("sources");
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<Drill>({});
  const [nodes, setNodes] = useState<BrowseNode[]>([]);
  const [pickedTable, setPickedTable] = useState<string | null>(null);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DataTab | null>(null);
  const [tabs, setTabs] = useState<DataTab[]>([]);
  const [ux, setUx] = useState<TabUx>("split");
  const [copied, setCopied] = useState(false);
  const [inspect, setInspect] = useState<{ row: number; col: number } | null>(null);
  const localEditAt = useRef(0);
  const tabRef = useRef<DataTab | null>(null);
  const pendingRun = useRef(false);
  tabRef.current = tab;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 10 : 14,
        gap: layout.compact ? 6 : 8,
      },
      chrome: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 10,
        flexWrap: "wrap" as const,
      },
      tabId: { color: theme.colors.accent, fontFamily: "Menlo", fontSize: 12, fontWeight: "600" as const },
      sub: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, flexWrap: "wrap" as const },
      crumb: { color: theme.colors.accent, fontSize: 13, fontWeight: "600" as const },
      crumbMute: { color: theme.colors.foregroundMuted, fontSize: 13 },
      toggle: {
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
      },
      toggleOn: { backgroundColor: theme.colors.accent },
      toggleText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      toggleTextOn: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
      input: {
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        color: theme.colors.foreground,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
      },
      sqlRow: { flexDirection: "row" as const, gap: 8, alignItems: "flex-start" as const },
      sql: {
        flex: 1,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        color: theme.colors.foreground,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 6,
        minHeight: layout.compact ? 40 : 52,
        fontFamily: "Menlo",
        fontSize: 12,
      },
      ghost: {
        paddingHorizontal: 8,
        paddingVertical: 4,
      },
      run: {
        backgroundColor: theme.colors.accent,
        borderRadius: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
      },
      runOff: { opacity: 0.4 },
      ghostText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      runText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      body: {
        flex: 1,
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        gap: layout.compact ? 8 : 12,
        minHeight: 0,
      },
      sources: { flex: layout.compact ? 1 : 0.28, minWidth: layout.compact ? 0 : 220, maxWidth: layout.compact ? undefined : 320, minHeight: 0 },
      viewer: { flex: layout.compact ? 1.4 : 0.72, minWidth: 0, minHeight: 0, gap: 6 },
      tree: { flex: 1 },
      item: { paddingVertical: 8, paddingRight: 8, paddingLeft: 2, borderRadius: 4 },
      itemOn: { borderLeftWidth: 2, borderLeftColor: theme.colors.accent, paddingLeft: 8 },
      chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
      chipOn: { backgroundColor: theme.colors.accent },
      chipText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      chipTextOn: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
      group: { color: theme.colors.foregroundMuted, fontWeight: "600" as const, fontSize: 12, marginBottom: 4 },
      name: { color: theme.colors.foreground },
      nameOn: { color: theme.colors.accentForeground },
      mute: { color: theme.colors.foregroundMuted, fontSize: 12 },
      muteOn: { color: theme.colors.accentForeground, fontSize: 12 },
      live: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" as const },
      error: { color: theme.colors.statusDanger },
      cell: { color: theme.colors.foreground, fontFamily: "Menlo", fontSize: 11, paddingVertical: 5 },
      cellOn: { color: theme.colors.accent },
      head: { color: theme.colors.foregroundMuted, fontFamily: "Menlo", fontSize: 11, paddingBottom: 4 },
      inspect: {
        maxHeight: layout.compact ? 160 : 220,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 6,
        padding: 8,
      },
      inspectBody: { color: theme.colors.foreground, fontFamily: "Menlo", fontSize: 11 },
    }),
    [theme, layout.compact],
  );

  const selectedConnection = drill.connectionId ? snapshot.connections.find((item) => item.id === drill.connectionId) ?? null : null;
  const atRoot = !drill.connectionId;
  const listing = atRoot ? "connections" : drill.schema ? "tables" : drill.database ? "schemas" : "databases";

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await fetchSnapshot({ workspaceId });
      setSnapshot(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Data");
    } finally {
      setBusy(false);
    }
  }, [fetchSnapshot, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadLevel = useCallback(
    async (next: Drill, skipSingletons: boolean) => {
      if (!next.connectionId) {
        setDrill({});
        setNodes([]);
        setPickedTable(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let connectionId = next.connectionId;
        let database = next.database;
        let schema = next.schema;
        const first = await fetchBrowse({ connectionId, database, schema });
        if (skipSingletons && !database) {
          const onlyDb = singletonName(first.items, "database");
          if (onlyDb) {
            database = onlyDb;
            const second = await fetchBrowse({ connectionId, database });
            const onlySchema = singletonName(second.items, "schema");
            if (onlySchema) {
              schema = onlySchema;
              const third = await fetchBrowse({ connectionId, database, schema });
              setDrill({ connectionId, database, schema });
              setNodes(third.items);
              return;
            }
            setDrill({ connectionId, database });
            setNodes(second.items);
            return;
          }
        }
        if (skipSingletons && database && !schema) {
          const onlySchema = singletonName(first.items, "schema");
          if (onlySchema) {
            schema = onlySchema;
            const third = await fetchBrowse({ connectionId, database, schema });
            setDrill({ connectionId, database, schema });
            setNodes(third.items);
            return;
          }
        }
        setDrill({ connectionId, database, schema });
        setNodes(first.items);
      } catch (caught) {
        setNodes([]);
        setError(caught instanceof Error ? caught.message : "Could not list catalog");
      } finally {
        setLoading(false);
      }
    },
    [fetchBrowse],
  );

  const drillRef = useRef(drill);
  drillRef.current = drill;
  const loadLevelRef = useRef(loadLevel);
  loadLevelRef.current = loadLevel;

  const applyRemote = useCallback((next: DataTab) => {
    const previous = tabRef.current;
    const shouldRun =
      !previous || previous.sql !== next.sql || tabConnectionId(previous) !== tabConnectionId(next) || previous.database !== next.database;
    setTab(next);
    setUx(next.ux);
    setSql(next.sql);
    const current = drillRef.current;
    if (current.connectionId !== tabConnectionId(next) || current.database !== next.database || current.schema !== next.schema) {
      void loadLevelRef.current(
        { connectionId: tabConnectionId(next), database: next.database, schema: next.schema },
        false,
      );
    }
    if (shouldRun && tabConnectionId(next) && next.sql.trim()) {
      pendingRun.current = true;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void bind({ workspaceId, agentId })
      .then((next) => {
        if (cancelled) {
          return;
        }
        setTabs(next.tabs);
        applyRemote(next.tab);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not bind Data tab");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, applyRemote, bind, workspaceId]);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = tabRef.current;
      if (!current) {
        return;
      }
      void fetchTab({ tabId: current.tabId })
        .then((next) => {
          if (Date.now() - localEditAt.current < 1600) {
            setTab(next);
            return;
          }
          if (next.updatedAt === current.updatedAt) {
            return;
          }
          applyRemote(next);
        })
        .catch(() => {});
      void fetchTabs({ workspaceId }).then((listed) => {
        setTabs(listed.tabs);
      });
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [applyRemote, fetchTab, fetchTabs, workspaceId]);

  useEffect(() => {
    const current = tabRef.current;
    if (!current) {
      return;
    }
    const unchanged =
      current.sql === sql &&
      current.ux === ux &&
      tabConnectionId(current) === drill.connectionId &&
      current.database === drill.database &&
      current.schema === drill.schema;
    if (unchanged) {
      return;
    }
    const timer = setTimeout(() => {
      localEditAt.current = Date.now();
      void saveTab({
        tabId: current.tabId,
        sql,
        ux,
        connectionId: drill.connectionId ?? null,
        database: drill.database ?? null,
        schema: drill.schema ?? null,
      }).then((next) => {
        setTab(next);
      });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [drill.database, drill.connectionId, drill.schema, saveTab, sql, ux]);

  const listed = useMemo(() => filterConnections(snapshot.connections, atRoot ? search : ""), [snapshot.connections, search, atRoot]);
  const sqls = useMemo(() => filterSqls(snapshot.sqls, search), [snapshot.sqls, search]);
  const visible = useMemo(() => filterNodes(nodes, atRoot ? "" : search), [nodes, search, atRoot]);
  const showSources = filter !== "sqls";
  const showSqls = filter !== "sources";

  function runWith(connection: DataConnection, text: string, database?: string): void {
    if (!connection.canQuery) {
      setError("Pick a Data Connection that can query.");
      return;
    }
    setRunning(true);
    setError(null);
    void query({ connectionId: connection.id, sql: text, database: database || drill.database })
      .then((next) => {
        setResult(next);
        setInspect(null);
      })
      .catch((caught: unknown) => {
        setResult(null);
        setError(caught instanceof Error ? caught.message : "Query failed");
      })
      .finally(() => {
        setRunning(false);
      });
  }

  function openConnection(item: DataConnection): void {
    if (!item.canQuery) {
      setError("This Data Connection has no secret on the daemon, so it cannot list tables.");
      return;
    }
    setPickedTable(null);
    setResult(null);
    setSearch("");
    void loadLevel({ connectionId: item.id }, true);
  }

  function openNode(item: BrowseNode): void {
    const connection = selectedConnection;
    if (!connection) {
      return;
    }
    if (item.kind === "database") {
      setPickedTable(null);
      setSearch("");
      void loadLevel({ connectionId: connection.id, database: item.name }, true);
      return;
    }
    if (item.kind === "schema") {
      setPickedTable(null);
      setSearch("");
      void loadLevel({ connectionId: connection.id, database: drill.database, schema: item.name }, false);
      return;
    }
    if (item.kind === "table" || item.kind === "view") {
      const text = item.sql ?? `select * from ${qualifyTable(connection.engine, drill.schema, item.name)} limit 100`;
      setPickedTable(item.name);
      setSql(text);
      if (tab) {
        void saveTab({ tabId: tab.tabId, title: item.name, sql: text, connectionId: connection.id, database: drill.database ?? null, schema: drill.schema ?? null }).then((next) => {
          setTab(next);
          setTabs((current) => current.map((entry) => (entry.tabId === next.tabId ? next : entry)));
        });
      }
      runWith(connection, text, drill.database);
    }
  }

  function pickSql(item: SqlFile): void {
    setError(null);
    void fetchSql({ path: item.path })
      .then((loaded) => {
        setSql(loaded.text);
        const ready = snapshot.connections.find(
          (connection) => connection.canQuery && connection.workspaceId === item.workspaceId,
        );
        if (ready) {
          setDrill((current) => current.connectionId ? current : { connectionId: ready.id });
        }
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not read SQL");
      });
  }

  function run(): void {
    const connection = selectedConnection ?? snapshot.connections.find((item) => item.canQuery);
    if (!connection?.canQuery) {
      setError("Pick a Data Connection that can query.");
      return;
    }
    runWith(connection, sql, drill.database);
  }

  useEffect(() => {
    if (!pendingRun.current) {
      return;
    }
    const connection = snapshot.connections.find(
      (item) => item.id === (drill.connectionId ?? (tab ? tabConnectionId(tab) : undefined)) && item.canQuery,
    );
    if (!connection || !sql.trim()) {
      return;
    }
    pendingRun.current = false;
    runWith(connection, sql, drill.database ?? tab?.database);
  }, [drill.database, drill.connectionId, snapshot.connections, sql, tab?.database, tab]);

  const crumbLabel =
    listing === "tables" ? "tables" : listing === "schemas" ? "schemas" : listing === "databases" ? "databases" : "Data Connections";
  const showCatalog = ux !== "query";
  const showQuery = ux !== "catalog";
  const showRecipes = filter === "sqls";
  const widths = result
    ? result.columns.map((column, index) => columnWidth(column, result.rows.map((row) => row[index] ?? null)))
    : [];
  const inspectValue =
    inspect && result ? result.rows[inspect.row]?.[inspect.col] ?? null : null;
  const inspectColumn = inspect && result ? result.columns[inspect.col] : null;

  function copyTabId(id: string): void {
    const nav = globalThis.navigator as { clipboard?: { writeText?: (value: string) => Promise<void> } } | undefined;
    void nav?.clipboard?.writeText?.(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function switchTab(tabId: string): void {
    void bind({ workspaceId, tabId }).then((next) => {
      setTabs(next.tabs);
      applyRemote(next.tab);
    });
  }

  function addQuery(): void {
    void makeTab({ workspaceId }).then((next) => {
      void bind({ workspaceId, tabId: next.tabId }).then((bound) => {
        setTabs(bound.tabs);
        applyRemote(bound.tab);
      });
    });
  }

  function removeQuery(tabId: string): void {
    void dropTab({ tabId }).then((next) => {
      setTabs(next.tabs);
      if (next.tab) {
        applyRemote(next.tab);
      }
    });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.chrome}>
        <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.row}>
          {tabs.map((item) => {
            const on = tab?.tabId === item.tabId;
            return (
              <Pressable
                key={item.tabId}
                accessibilityRole="button"
                accessibilityLabel={`Query ${tabLabel(item)}`}
                onPress={() => switchTab(item.tabId)}
                onLongPress={() => copyTabId(item.tabId)}
                style={[styles.chip, on ? styles.chipOn : null]}
              >
                <Text style={on ? styles.chipTextOn : styles.chipText}>{tabLabel(item)}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="New query" onPress={addQuery} style={styles.chip}>
            <Text style={styles.chipText}>+</Text>
          </Pressable>
          {tab && tabs.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close query"
              onPress={() => removeQuery(tab.tabId)}
              style={styles.chip}
            >
              <Text style={styles.chipText}>×</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy data tab id"
            onPress={() => {
              if (tab) {
                copyTabId(tab.tabId);
              }
            }}
          >
            <Text style={styles.ghostText}>{copied ? "copied" : tab?.tabId ?? ""}</Text>
          </Pressable>
          {(
            [
              ["split", "split"],
              ["catalog", "catalog"],
              ["query", "query"],
            ] as const
          ).map(([id, label]) => {
            const on = ux === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={`UX ${label}`}
                onPress={() => setUx(id)}
                style={[styles.toggle, on ? styles.toggleOn : null]}
              >
                <Text style={on ? styles.toggleTextOn : styles.toggleText}>{label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            onPress={() => {
              void refresh();
              if (drill.connectionId) {
                void loadLevel(drill, false);
              }
            }}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>{busy || loading ? "…" : "refresh"}</Text>
          </Pressable>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.body}>
        {showCatalog ? (
        <View style={styles.sources}>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="All Data Connections"
              onPress={() => {
                setSearch("");
                setPickedTable(null);
                void loadLevel({}, false);
              }}
            >
              <Text style={atRoot ? styles.crumbMute : styles.crumb}>Data Connections</Text>
            </Pressable>
            {selectedConnection ? (
              <>
                <Text style={styles.crumbMute}>›</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Data Connection ${selectedConnection.name}`}
                  onPress={() => {
                    setSearch("");
                    setPickedTable(null);
                    void loadLevel({ connectionId: selectedConnection.id }, false);
                  }}
                >
                  <Text style={!drill.database ? styles.crumbMute : styles.crumb}>{selectedConnection.name}</Text>
                </Pressable>
              </>
            ) : null}
            {drill.database ? (
              <>
                <Text style={styles.crumbMute}>›</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Database ${drill.database}`}
                  onPress={() => {
                    setSearch("");
                    setPickedTable(null);
                    void loadLevel({ connectionId: drill.connectionId, database: drill.database }, false);
                  }}
                >
                  <Text style={!drill.schema ? styles.crumbMute : styles.crumb}>{drill.database}</Text>
                </Pressable>
              </>
            ) : null}
            {drill.schema ? (
              <>
                <Text style={styles.crumbMute}>›</Text>
                <Text style={styles.crumbMute}>{drill.schema}</Text>
              </>
            ) : null}
          </View>
          <TextInput
            accessibilityLabel="Search"
            placeholder={showRecipes ? "Filter SQL" : atRoot ? "Find a source" : `Filter ${crumbLabel}`}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.input}
          />
          <ScrollView style={styles.tree}>
            {showSources ? (
              <>
                <Text style={styles.group}>
                  {loading ? `Loading ${crumbLabel}…` : `${atRoot ? listed.length : visible.length} ${crumbLabel}`}
                </Text>
                {atRoot
                  ? listed.map((item) => {
                      const on = drill.connectionId === item.id;
                      return (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Data Connection ${item.name}, ${item.status}`}
                          onPress={() => openConnection(item)}
                          style={[styles.item, on ? styles.itemOn : null]}
                        >
                          <Text style={on ? styles.live : styles.name} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={on ? styles.muteOn : item.canQuery ? styles.live : styles.mute} numberOfLines={1}>
                            {item.canQuery ? `${item.engine} · ${fileTypeLabel(item.fileType)}` : item.status}
                          </Text>
                        </Pressable>
                      );
                    })
                  : visible.map((item) => {
                      const on = pickedTable === item.name && (item.kind === "table" || item.kind === "view");
                      const drillable = item.kind === "database" || item.kind === "schema";
                      return (
                        <Pressable
                          key={`${item.kind}:${item.name}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.kind} ${item.name}`}
                          onPress={() => openNode(item)}
                          style={[styles.item, on ? styles.itemOn : null]}
                        >
                          <Text style={on ? styles.live : styles.name} numberOfLines={1}>
                            {item.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                {!loading && atRoot && listed.length === 0 ? (
                  <Text style={styles.mute}>No data sources on this Paseo yet.</Text>
                ) : null}
                {!loading && !atRoot && visible.length === 0 ? (
                  <Text style={styles.mute}>No {crumbLabel} here.</Text>
                ) : null}
              </>
            ) : null}
            {showRecipes ? (
              <>
                <Text style={[styles.group, { marginTop: showSources ? 12 : 0 }]}>Recipes</Text>
                {sqls.length === 0 ? (
                  <Text style={styles.mute}>Open a workspace Data panel to load .sql recipes.</Text>
                ) : null}
                {sqls.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Load ${item.name}`}
                    onPress={() => pickSql(item)}
                    style={styles.item}
                  >
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.mute} numberOfLines={1}>
                      {item.kind}
                      {item.workspaceTitle ? ` · ${item.workspaceTitle}` : ""}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
          </ScrollView>
        </View>
        ) : null}
        {showQuery ? (
        <View style={styles.viewer}>
          <View style={styles.sqlRow}>
          <TextInput
            accessibilityLabel="SQL"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={DEFAULT_SQL}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={sql}
            onChangeText={setSql}
            style={styles.sql}
          />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run SQL"
              onPress={run}
              style={[styles.run, selectedConnection?.canQuery ? null : styles.runOff]}
            >
              <Text style={styles.runText}>{running ? "…" : "Run"}</Text>
            </Pressable>
          </View>
          {result ? (
            <>
            <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
            <ScrollView horizontal>
              <View>
                <View style={styles.row}>
                  {result.columns.map((column, index) => (
                    <Text key={column} style={[styles.head, { width: widths[index] }]} numberOfLines={1}>
                      {column}
                    </Text>
                  ))}
                </View>
                {result.rows.map((row, index) => (
                  <View key={index} style={styles.row}>
                    {row.map((cell, cellIndex) => {
                      const on = inspect?.row === index && inspect.col === cellIndex;
                      return (
                        <Pressable
                          key={`${index}:${cellIndex}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Inspect ${result.columns[cellIndex]} row ${index + 1}`}
                          onPress={() => setInspect({ row: index, col: cellIndex })}
                          style={{ width: widths[cellIndex] }}
                        >
                          <Text style={on ? styles.cellOn : styles.cell} numberOfLines={1}>
                            {previewCell(cell)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                <Text style={styles.mute}>
                  {result.rowCount} row{result.rowCount === 1 ? "" : "s"} · {result.ms}ms
                  {result.truncated ? " · truncated" : ""}
                  {inspectColumn ? ` · ${inspectColumn}` : " · click a cell"}
                </Text>
              </View>
            </ScrollView>
            </ScrollView>
            {inspect && inspectValue != null ? (
              <ScrollView style={styles.inspect}>
                <Text style={styles.mute}>{inspectColumn} · row {inspect.row + 1}</Text>
                <Text style={styles.inspectBody} selectable>
                  {prettyCell(inspectValue)}
                </Text>
              </ScrollView>
            ) : null}
            </>
          ) : (
            <Text style={styles.mute}>Open a table, or type SQL and Run.</Text>
          )}
        </View>
        ) : null}
      </View>
    </View>
  );
}

export function MainSurface(props: PluginSurfaceProps) {
  return <DataDesk {...props} />;
}

export function WorkspaceSurface(props: PluginWorkspacePanelProps) {
  const name = useWorkspace(props.workspaceId, (workspace) => workspace.name);
  return <DataDesk {...props} workspaceId={props.workspaceId} key={name ?? props.workspaceId} />;
}

export function AgentSurface(props: PluginAgentPanelProps) {
  return <DataDesk {...props} workspaceId={props.workspaceId} agentId={props.agentId} />;
}
