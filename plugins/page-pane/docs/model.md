# Paseo Browserbase — data model

Product name: **Paseo Browserbase**.  
Install id: `page-pane` (do not rename; Paseo already has this plugin loaded).

A Paseo **chat** is a **workspace**. The workspace tab strip holds sessions of different kinds: agents, files, terminal, and Browser Base groups. Those are Paseo tabs. They are not web pages.

## Objects

| Object | Owns | Is |
| --- | --- | --- |
| Context | tenant / host | One Browserbase persist jar (`contextId`). Not a tab. |
| Group | **workspace** | One Browserbase cloud session. One Paseo workspace tab. Display name: Browser Base Group N. |
| Page | group | One URL / CDP target inside that session. |
| Agent | workspace | A coding agent tab. Does **not** own a group. |
| Link | workspace | Join row `{ workspaceId, agentId, groupId }`. |
| View | user | `{ mode: pages \| thumbs, defaultSize }`. How pages are shown, in every group. |

```
workspace
  ├── agent Implement ──link──┐
  ├── agent Review    ──link──┼── group 1 (session) ── pages (URLs)
  ├── files                   └── group 2 (session) ── pages
  └── terminal
```

## Rules

1. **Group is workspace-owned.** Creating a group adds a Paseo tab on that workspace. It is not nested in an agent transcript.
2. **An agent links to a group.** The default is one link (this agent drives that group). An agent may link to more than one group.
3. **Many agents may link to the same group.** Implement and Review can share Group 1. That is one Browserbase session, two drivers — the same sharing model as Files. Do not clone a session per agent.
4. **Page ≠ Paseo tab.** Pages are URLs inside a group. Paseo tabs are Agent / Files / Terminal / Group.
5. **Pages vs thumbnails** is one viewing mode for the user. Switching it in one group switches it everywhere. Per-page size (S/M/L/XL) stays on that page.
6. **Live vs still.** In thumbnail mode only the focused page should be a live view. The rest are stills. The wireframe marks this; the iframe host must not open N live sessions at XL.
7. **Groups are workspace tabs.** Paseo can only mount one tab per plugin panel id, so this plugin registers Browser Base Group 1–6. Add them from the workspace **+** / New tab menu, the same way as Files or Terminal. Pages stay as subtabs inside that group. Do not nest Group 1 | Group 2 inside one plugin panel.

## Identifiers

- `groupId` = Browserbase `session.id`. Same string on the wire as `sessionId`.
- `group.workspaceId` = the Paseo workspace that owns the group (from session metadata).
- `page.id` = Browserbase/CDP page target id.
- `link.groupId` points at `group.groupId`.
- Forbidden: Greenmark project `2080dfe2-9805-4fc7-be2f-512dc5762e90`, SSO context `495790be-eb42-40bd-82fa-e72d31740eac`.

## Persistence

Daemon file `~/.paseo/page-pane/state.json`:

- `view` — user viewing prefs
- `links` — agent↔group joins
- `pageSizes` — optional per-page thumbnail size, key `groupId:pageId`
- `groupWorkspaces` — `groupId → workspaceId` so a group stays on its workspace after reload
- `groupSlots` — `workspaceId → groupId[]` (slot index is the workspace tab)

Browserbase holds the live session and pages. Paseo holds workspace tabs. This file holds joins and view prefs.

## RPCs

| RPC | Role |
| --- | --- |
| `group.snapshot` | Context, view, groups, links |
| `group.start` | New group (new Browserbase session) |
| `group.page` | New page (URL) in a group |
| `group.go` / `back` / `reload` | Drive one page |
| `link.add` / `link.remove` | Agent ↔ group join |
| `view.set` | Pages vs thumbnails, default size |

`group.*` input `groupId` is the Browserbase session id.
