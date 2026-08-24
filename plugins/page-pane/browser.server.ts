import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import type { Snapshot, ViewPrefs } from "./browser.model";
import { DEFAULT_GROUPS, GROUP_SLOT_COUNT } from "./browser.model";
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

const EIDOS_PROJECT_ID = "bd0d23c2-2ce4-4b00-80ba-08b8d8185867";
const FORBIDDEN_PROJECT_ID = "2080dfe2-9805-4fc7-be2f-512dc5762e90";
const FORBIDDEN_CONTEXT_ID = "495790be-eb42-40bd-82fa-e72d31740eac";
const CONTEXT_NAME = "paseo-desktop";
const PURPOSE = "paseo-page-pane";
const API = "https://api.browserbase.com";
const QUEUE_PATH = join(homedir(), ".paseo/page-pane/queue");
const STATE_PATH = join(homedir(), ".paseo/page-pane/state.json");

type LiveSession = {
  id: string;
  connectUrl: string;
  projectId: string;
  workspaceId?: string;
};

type PluginState = {
  view: ViewPrefs;
  links: Snapshot["links"];
  pageSizes: Record<string, Snapshot["view"]["defaultSize"]>;
  groupWorkspaces: Record<string, string>;
  groupSlots: Record<string, string[]>;
};

const defaultState = (): PluginState => ({
  view: { mode: "pages", defaultSize: "m" },
  links: [],
  pageSizes: {},
  groupWorkspaces: {},
  groupSlots: {},
});

type CdpResult = Record<string, unknown>;

const sessions = new Map<string, LiveSession>();
let cachedContextId: string | null = null;

function secretPath(name: string): string {
  return join(homedir(), ".paseo/secrets", name);
}

function readSecret(name: string): string | null {
  const envName =
    name === "browserbase-api-key"
      ? "BROWSERBASE_API_KEY"
      : name === "browserbase-project-id"
        ? "BROWSERBASE_PROJECT_ID"
        : "BROWSERBASE_CONTEXT_ID";
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const value = readFileSync(secretPath(name), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeSecret(name: string, value: string): void {
  mkdirSync(join(homedir(), ".paseo/secrets"), { recursive: true, mode: 0o700 });
  writeFileSync(secretPath(name), value, { encoding: "utf8", mode: 0o600 });
}

function loadState(): PluginState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<PluginState>;
    return {
      view: {
        mode: raw.view?.mode === "thumbs" ? "thumbs" : "pages",
        defaultSize: ["s", "m", "l", "xl"].includes(raw.view?.defaultSize ?? "")
          ? (raw.view?.defaultSize as ViewPrefs["defaultSize"])
          : "m",
      },
      links: Array.isArray(raw.links)
        ? raw.links.filter(
            (link) =>
              link &&
              typeof link.workspaceId === "string" &&
              typeof link.agentId === "string" &&
              typeof link.groupId === "string",
          )
        : [],
      pageSizes:
        raw.pageSizes && typeof raw.pageSizes === "object"
          ? Object.fromEntries(
              Object.entries(raw.pageSizes).filter(([, size]) => ["s", "m", "l", "xl"].includes(size)),
            )
          : {},
      groupWorkspaces:
        raw.groupWorkspaces && typeof raw.groupWorkspaces === "object"
          ? Object.fromEntries(
              Object.entries(raw.groupWorkspaces).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
              ),
            )
          : {},
      groupSlots:
        raw.groupSlots && typeof raw.groupSlots === "object"
          ? Object.fromEntries(
              Object.entries(raw.groupSlots).flatMap(([workspaceId, slots]) => {
                if (!Array.isArray(slots)) {
                  return [];
                }
                return [
                  [
                    workspaceId,
                    slots
                      .slice(0, GROUP_SLOT_COUNT)
                      .map((id) => (typeof id === "string" ? id : "")),
                  ] as [string, string[]],
                ];
              }),
            )
          : {},
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: PluginState): void {
  mkdirSync(join(homedir(), ".paseo/page-pane"), { recursive: true, mode: 0o700 });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}

function sameLink(
  left: Snapshot["links"][number],
  right: Snapshot["links"][number],
): boolean {
  return left.workspaceId === right.workspaceId && left.agentId === right.agentId && left.groupId === right.groupId;
}

function apiKey(): string {
  const key = readSecret("browserbase-api-key");
  if (!key) {
    throw new Error("Browserbase API key missing. Expected ~/.paseo/secrets/browserbase-api-key");
  }
  return key;
}

function projectId(): string {
  const id = readSecret("browserbase-project-id") || EIDOS_PROJECT_ID;
  if (id === FORBIDDEN_PROJECT_ID) {
    throw new Error("Refusing Greenmark Browserbase project");
  }
  return id;
}

function httpUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  return url.toString();
}

function hostKey(raw: string): string {
  try {
    return new URL(httpUrl(raw)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

function isStarterHost(host: string): boolean {
  return host === "example.com" || host === "example.org" || host === "example.net" || host === "wikipedia.org";
}

function slotUrls(slot: number, url?: string): readonly string[] {
  const preset = DEFAULT_GROUPS[slot];
  if (preset) {
    return preset;
  }
  return [httpUrl(url || DEFAULT_GROUPS[0][0])];
}

async function bb(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "X-BB-API-Key": apiKey(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const record = json as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : `Browserbase ${method} ${path} failed (${res.status})`;
    throw new Error(message);
  }
  return json;
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: CdpResult) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) {
        return;
      }
      let message: { id?: number; error?: { message?: string }; result?: CdpResult };
      try {
        message = JSON.parse(raw) as typeof message;
      } catch {
        return;
      }
      if (typeof message.id !== "number") {
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(message.error.message || "CDP error"));
        return;
      }
      waiter.resolve(message.result ?? {});
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("CDP connect timed out"));
      }, 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(socket));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP socket failed"));
      });
    });
  }

  call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`${method} timed out`));
        }
      }, 20_000);
    });
  }

  close(): void {
    this.socket.close();
  }
}

function remember(session: LiveSession): LiveSession {
  const existing = sessions.get(session.id);
  const merged = {
    ...session,
    connectUrl: session.connectUrl || existing?.connectUrl || "",
    workspaceId: session.workspaceId || existing?.workspaceId,
  };
  sessions.set(merged.id, merged);
  return merged;
}

async function ensureContext(): Promise<string> {
  if (cachedContextId) {
    return cachedContextId;
  }
  const existing = readSecret("browserbase-context-id");
  if (existing === FORBIDDEN_CONTEXT_ID) {
    throw new Error("Refusing Daniel SSO Browserbase context");
  }
  if (existing) {
    cachedContextId = existing;
    return existing;
  }
  const created = (await bb("POST", "/v1/contexts", { projectId: projectId(), name: CONTEXT_NAME })) as Record<
    string,
    unknown
  >;
  const id = typeof created.id === "string" ? created.id : "";
  if (!id || id === FORBIDDEN_CONTEXT_ID) {
    throw new Error("Failed to create Browserbase context");
  }
  writeSecret("browserbase-context-id", id);
  cachedContextId = id;
  return id;
}

async function createBrowserSession(workspaceId?: string): Promise<LiveSession> {
  const contextId = await ensureContext();
  const created = (await bb("POST", "/v1/sessions", {
    projectId: projectId(),
    keepAlive: true,
    browserSettings: { context: { id: contextId, persist: true } },
    userMetadata: {
      purpose: PURPOSE,
      via: "paseo-browserbase",
      ...(workspaceId ? { workspaceId } : {}),
    },
  })) as Record<string, unknown>;
  const id = typeof created.id === "string" ? created.id : "";
  const connectUrl = typeof created.connectUrl === "string" ? created.connectUrl : "";
  const createdProject = typeof created.projectId === "string" ? created.projectId : projectId();
  const contextUsed = typeof created.contextId === "string" ? created.contextId : null;
  if (!id || !connectUrl) {
    throw new Error("Browserbase session create returned no connection");
  }
  if (createdProject === FORBIDDEN_PROJECT_ID || contextUsed === FORBIDDEN_CONTEXT_ID) {
    throw new Error("Refusing forbidden Browserbase project or context");
  }
  if (workspaceId) {
    const state = loadState();
    state.groupWorkspaces[id] = workspaceId;
    saveState(state);
  }
  return remember({ id, connectUrl, projectId: createdProject, workspaceId });
}

async function cdpUrl(session: LiveSession): Promise<string> {
  if (session.connectUrl) {
    return session.connectUrl;
  }
  const debug = (await bb("GET", `/v1/sessions/${session.id}/debug`)) as Record<string, unknown>;
  if (typeof debug.wsUrl === "string" && debug.wsUrl) {
    session.connectUrl = debug.wsUrl;
    remember(session);
    return debug.wsUrl;
  }
  throw new Error("Cloud browser has no CDP URL");
}

async function withPage(
  session: LiveSession,
  pageId: string | undefined,
  fn: (cdp: Cdp, pageSessionId: string | undefined) => Promise<void>,
): Promise<void> {
  const cdp = await Cdp.connect(await cdpUrl(session));
  try {
    let pageSessionId: string | undefined;
    try {
      const targets = await cdp.call("Target.getTargets");
      const infos = Array.isArray(targets.targetInfos) ? (targets.targetInfos as Array<{ type?: string; targetId?: string }>) : [];
      const page =
        (pageId ? infos.find((item) => item.targetId === pageId) : undefined) ??
        infos.find((item) => item.type === "page");
      if (page?.targetId) {
        const attached = await cdp.call("Target.attachToTarget", { targetId: page.targetId, flatten: true });
        if (typeof attached.sessionId === "string") {
          pageSessionId = attached.sessionId;
        }
      }
    } catch {
      pageSessionId = undefined;
    }
    await cdp.call("Page.enable", {}, pageSessionId);
    await fn(cdp, pageSessionId);
  } finally {
    cdp.close();
  }
}

async function sessionPages(session: LiveSession): Promise<Snapshot["groups"][number]> {
  const debug = (await bb("GET", `/v1/sessions/${session.id}/debug`)) as Record<string, unknown>;
  if (typeof debug.wsUrl === "string" && debug.wsUrl && !session.connectUrl) {
    session.connectUrl = debug.wsUrl;
    remember(session);
  }
  const listed = Array.isArray(debug.pages) ? debug.pages : [];
  const fallback = typeof debug.debuggerFullscreenUrl === "string" ? debug.debuggerFullscreenUrl : "";
  const state = loadState();
  const pages = listed.map((item, index) => {
    const page = item as Record<string, unknown>;
    const live =
      (typeof page.debuggerFullscreenUrl === "string" && page.debuggerFullscreenUrl) || fallback;
    const id = typeof page.id === "string" && page.id ? page.id : `${session.id}:${index}`;
    const size = state.pageSizes[`${session.id}:${id}`];
    return {
      id,
      url: typeof page.url === "string" && page.url ? page.url : "about:blank",
      title: typeof page.title === "string" && page.title ? page.title : "",
      liveViewUrl: live,
      ...(size ? { size } : {}),
    };
  }).filter((page) => page.liveViewUrl);
  if (pages.length === 0 && fallback) {
    pages.push({ id: session.id, url: "about:blank", title: "", liveViewUrl: fallback });
  }
  return {
    groupId: session.id,
    sessionId: session.id,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    pages,
  };
}

async function runningOurs(): Promise<LiveSession[]> {
  const listed = await bb("GET", "/v1/sessions?status=RUNNING");
  const rows = Array.isArray(listed) ? listed : [];
  const owned = loadState().groupWorkspaces;
  const ours: LiveSession[] = [];
  for (const row of rows) {
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    const project = typeof item.projectId === "string" ? item.projectId : "";
    const contextId = typeof item.contextId === "string" ? item.contextId : null;
    const meta = item.userMetadata as Record<string, unknown> | undefined;
    const purpose = typeof meta?.purpose === "string" ? meta.purpose : "";
    if (!id || project !== projectId() || purpose !== PURPOSE) {
      continue;
    }
    if (contextId === FORBIDDEN_CONTEXT_ID || project === FORBIDDEN_PROJECT_ID) {
      continue;
    }
    const workspaceId =
      (typeof meta?.workspaceId === "string" && meta.workspaceId) || owned[id] || undefined;
    ours.push(
      remember({
        id,
        connectUrl: sessions.get(id)?.connectUrl || "",
        projectId: project,
        workspaceId,
      }),
    );
  }
  return ours;
}

async function openPages(session: LiveSession, urls: readonly string[]): Promise<void> {
  if (urls.length === 0) {
    return;
  }
  await withPage(session, undefined, (cdp, pageSessionId) =>
    cdp.call("Page.navigate", { url: httpUrl(urls[0]) }, pageSessionId).then(() => undefined),
  );
  for (const url of urls.slice(1)) {
    await withPage(session, undefined, (cdp) =>
      cdp.call("Target.createTarget", { url: httpUrl(url) }).then(() => undefined),
    );
  }
}

async function fillGroupTo(
  session: LiveSession,
  pages: Snapshot["groups"][number]["pages"],
  desired: readonly string[],
): Promise<void> {
  const desiredHosts = desired.map(hostKey);
  const have = new Set(pages.map((page) => hostKey(page.url)));
  const first = pages[0];
  if (
    first &&
    pages.length === 1 &&
    isStarterHost(hostKey(first.url)) &&
    !desiredHosts.includes(hostKey(first.url))
  ) {
    await withPage(session, first.id, (cdp, pageSessionId) =>
      cdp.call("Page.navigate", { url: httpUrl(desired[0]) }, pageSessionId).then(() => undefined),
    );
    have.delete(hostKey(first.url));
    have.add(hostKey(desired[0]));
  }
  for (const url of desired) {
    if (have.has(hostKey(url))) {
      continue;
    }
    await withPage(session, undefined, (cdp) =>
      cdp.call("Target.createTarget", { url: httpUrl(url) }).then(() => undefined),
    );
    have.add(hostKey(url));
  }
}

function scopedSessions(ours: LiveSession[], workspaceId?: string): LiveSession[] {
  if (!workspaceId) {
    return ours;
  }
  return ours.filter((session) => session.workspaceId === workspaceId);
}

async function claimUntagged(ours: LiveSession[], workspaceId: string): Promise<LiveSession[]> {
  const state = loadState();
  let changed = false;
  for (const session of ours) {
    if (!session.workspaceId) {
      session.workspaceId = workspaceId;
      state.groupWorkspaces[session.id] = workspaceId;
      remember(session);
      changed = true;
    }
  }
  if (changed) {
    saveState(state);
  }
  return scopedSessions(ours, workspaceId);
}

function bindSlots(workspaceId: string, ours: LiveSession[]): string[] {
  const state = loadState();
  const running = new Set(ours.map((session) => session.id));
  const slots = Array.from({ length: GROUP_SLOT_COUNT }, (_, index) => {
    const id = state.groupSlots[workspaceId]?.[index] ?? "";
    return running.has(id) ? id : "";
  });
  const bound = new Set(slots.filter(Boolean));
  for (const session of ours) {
    if (bound.has(session.id)) {
      continue;
    }
    const empty = slots.findIndex((id) => !id);
    if (empty < 0) {
      break;
    }
    slots[empty] = session.id;
    bound.add(session.id);
  }
  state.groupSlots[workspaceId] = slots;
  saveState(state);
  return slots;
}

async function ensureSlot(workspaceId: string, slot: number, url?: string): Promise<void> {
  const ours = await claimUntagged(await runningOurs(), workspaceId);
  const slots = bindSlots(workspaceId, ours);
  const existingId = slots[slot];
  const existing = existingId ? ours.find((session) => session.id === existingId) : undefined;
  const desired = slotUrls(slot, url);
  if (existing) {
    const group = await sessionPages(existing);
    if (group.pages.length <= 1) {
      await fillGroupTo(existing, group.pages, desired);
    }
    return;
  }
  const session = await createBrowserSession(workspaceId);
  await openPages(session, desired);
  const state = loadState();
  const next = [...(state.groupSlots[workspaceId] ?? slots)];
  while (next.length < GROUP_SLOT_COUNT) {
    next.push("");
  }
  next[slot] = session.id;
  state.groupSlots[workspaceId] = next.slice(0, GROUP_SLOT_COUNT);
  saveState(state);
}

let layoutGate: Promise<void> = Promise.resolve();

function enqueueLayout<T>(work: () => Promise<T>): Promise<T> {
  const run = layoutGate.then(work, work);
  layoutGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function snapshot(workspaceId?: string): Promise<Snapshot> {
  const contextId = await ensureContext();
  let ours = await runningOurs();
  let slots: string[] = [];
  if (workspaceId) {
    ours = await claimUntagged(ours, workspaceId);
    slots = bindSlots(workspaceId, ours);
  }
  const groups = (
    await Promise.all(
      ours.map(async (session) => {
        const group = await sessionPages(session);
        const slot = slots.indexOf(session.id);
        return slot >= 0 ? { ...group, slot } : group;
      }),
    )
  ).filter((group) => !workspaceId || group.workspaceId === workspaceId);
  const state = loadState();
  const links = workspaceId
    ? state.links.filter((link) => link.workspaceId === workspaceId)
    : state.links;
  return { contextId, view: state.view, groups, links };
}

function drainQueueLines(): string[] {
  try {
    const text = readFileSync(QUEUE_PATH, "utf8");
    writeFileSync(QUEUE_PATH, "", { encoding: "utf8", mode: 0o600 });
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function applyQueue(): Promise<void> {
  mkdirSync(join(homedir(), ".paseo/page-pane"), { recursive: true, mode: 0o700 });
  const lines = drainQueueLines();
  if (lines.length === 0) {
    return;
  }
  mkdirSync(join(homedir(), ".paseo/page-pane"), { recursive: true, mode: 0o700 });
  const ours = await runningOurs();
  let latest = ours.at(-1) ?? null;
  for (const line of lines) {
    const tabMatch = /^\+\s+(\S+)/.exec(line);
    if (tabMatch) {
      const url = httpUrl(tabMatch[1]);
      if (!latest) {
        latest = await createBrowserSession();
      }
      await withPage(latest, undefined, (cdp) => cdp.call("Target.createTarget", { url }).then(() => undefined));
      continue;
    }
    const url = httpUrl(line);
    latest = await createBrowserSession();
    await withPage(latest, undefined, (cdp, pageSessionId) =>
      cdp.call("Page.navigate", { url }, pageSessionId).then(() => undefined),
    );
  }
}

async function requireGroup(groupId: string): Promise<LiveSession> {
  const ours = await runningOurs();
  const session = ours.find((item) => item.id === groupId) ?? sessions.get(groupId);
  if (!session) {
    throw new Error("Unknown Browser Base group.");
  }
  return session;
}

export async function takeSnapshot({
  workspaceId,
  slot,
}: ZodOutput<typeof groupSnapshot.input>): Promise<Snapshot> {
  return enqueueLayout(async () => {
    await applyQueue();
    if (workspaceId && slot != null) {
      await ensureSlot(workspaceId, slot);
    }
    return snapshot(workspaceId);
  });
}

export async function start({
  url,
  workspaceId,
  slot,
}: ZodOutput<typeof groupStart.input>): Promise<Snapshot> {
  return enqueueLayout(async () => {
    await applyQueue();
    if (workspaceId && slot != null) {
      await ensureSlot(workspaceId, slot, url);
      return snapshot(workspaceId);
    }
    if (workspaceId) {
      const ours = await claimUntagged(await runningOurs(), workspaceId);
      const empty = bindSlots(workspaceId, ours).findIndex((id) => !id);
      if (empty >= 0) {
        await ensureSlot(workspaceId, empty, url);
        return snapshot(workspaceId);
      }
    }
    const session = await createBrowserSession(workspaceId);
    await openPages(session, [httpUrl(url)]);
    return snapshot(workspaceId);
  });
}

export async function addPage({ groupId, url }: ZodOutput<typeof groupPage.input>): Promise<Snapshot> {
  return enqueueLayout(async () => {
    await applyQueue();
    const ours = await runningOurs();
    const session = groupId ? await requireGroup(groupId) : ours.at(-1);
    const target = session ?? (await createBrowserSession());
    await withPage(target, undefined, (cdp) =>
      cdp.call("Target.createTarget", { url: httpUrl(url) }).then(() => undefined),
    );
    return snapshot();
  });
}

export async function go({ groupId, pageId, url }: ZodOutput<typeof groupGo.input>): Promise<Snapshot> {
  const session = await requireGroup(groupId);
  await withPage(session, pageId, (cdp, pageSessionId) =>
    cdp.call("Page.navigate", { url: httpUrl(url) }, pageSessionId).then(() => undefined),
  );
  return snapshot();
}

export async function back({ groupId, pageId }: ZodOutput<typeof groupBack.input>): Promise<Snapshot> {
  const session = await requireGroup(groupId);
  await withPage(session, pageId, async (cdp, pageSessionId) => {
    const history = await cdp.call("Page.getNavigationHistory", {}, pageSessionId);
    const entries = Array.isArray(history.entries) ? history.entries : [];
    const currentIndex = typeof history.currentIndex === "number" ? history.currentIndex : 0;
    const previous = entries[currentIndex - 1] as { id?: number } | undefined;
    if (typeof previous?.id === "number") {
      await cdp.call("Page.navigateToHistoryEntry", { entryId: previous.id }, pageSessionId);
    }
  });
  return snapshot();
}

export async function reload({ groupId, pageId }: ZodOutput<typeof groupReload.input>): Promise<Snapshot> {
  const session = await requireGroup(groupId);
  await withPage(session, pageId, (cdp, pageSessionId) => cdp.call("Page.reload", {}, pageSessionId).then(() => undefined));
  return snapshot();
}

export async function addLink(input: ZodOutput<typeof linkAdd.input>): Promise<Snapshot> {
  const state = loadState();
  if (!state.links.some((link) => sameLink(link, input))) {
    state.links.push(input);
    saveState(state);
  }
  return snapshot(input.workspaceId);
}

export async function removeLink(input: ZodOutput<typeof linkRemove.input>): Promise<Snapshot> {
  const state = loadState();
  state.links = state.links.filter((link) => !sameLink(link, input));
  saveState(state);
  return snapshot(input.workspaceId);
}

export async function setView(input: ZodOutput<typeof viewSet.input>): Promise<Snapshot> {
  const state = loadState();
  if (input.mode) {
    state.view.mode = input.mode;
  }
  if (input.defaultSize) {
    state.view.defaultSize = input.defaultSize;
  }
  saveState(state);
  return snapshot();
}
