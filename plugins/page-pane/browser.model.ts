import { z } from "zod";

/** Viewing mode for pages inside a group. Global for the user, not per group. */
export const viewMode = z.enum(["pages", "thumbs"]);
export const pageSize = z.enum(["s", "m", "l", "xl"]);

/**
 * One URL inside a Browser Base group.
 * This is a Browserbase/CDP page target, not a Paseo workspace tab.
 */
export const pageView = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  liveViewUrl: z.string(),
  size: pageSize.optional(),
});

/**
 * One Browser Base group = one Browserbase cloud session = one Paseo workspace tab.
 * Owned by the workspace. Not owned by an agent.
 */
export const groupView = z.object({
  groupId: z.string(),
  sessionId: z.string(),
  workspaceId: z.string().optional(),
  slot: z.number().int().min(0).optional(),
  pages: z.array(pageView),
});

/**
 * Join: an agent tab links to a group. Many agents may link to the same group.
 * Many groups may be linked from the same agent. The group is not copied per agent.
 */
export const agentGroupLink = z.object({
  workspaceId: z.string(),
  agentId: z.string(),
  groupId: z.string(),
});

/** How the user looks at pages. Stored beside the user, not inside a session. */
export const viewPrefs = z.object({
  mode: viewMode,
  defaultSize: pageSize,
});

export const snapshotOut = z.object({
  contextId: z.string(),
  view: viewPrefs,
  groups: z.array(groupView),
  links: z.array(agentGroupLink),
});

export type PageView = z.infer<typeof pageView>;
export type GroupView = z.infer<typeof groupView>;
export type AgentGroupLink = z.infer<typeof agentGroupLink>;
export type ViewPrefs = z.infer<typeof viewPrefs>;
export type Snapshot = z.infer<typeof snapshotOut>;

/** Paseo can only open one workspace tab per plugin panel id. Each slot is a real workspace tab. */
export const GROUP_SLOT_COUNT = 6;

export function groupPanelId(slot: number): string {
  return slot === 0 ? "browserbase" : `browserbase-${slot + 1}`;
}

export function groupPanelTitle(slot: number): string {
  return `Browser Base Group ${slot + 1}`;
}

/** Pages opened when that workspace tab is added. Later slots start with one real site. */
export const DEFAULT_GROUPS = [
  ["https://www.wikipedia.org", "https://news.ycombinator.com", "https://github.com"],
  ["https://www.iana.org/domains/reserved", "http://info.cern.ch", "https://www.rfc-editor.org"],
] as const;
