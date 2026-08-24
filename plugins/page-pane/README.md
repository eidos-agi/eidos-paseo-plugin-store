# Paseo Browserbase

Trusted local Paseo plugin that puts a **Browserbase cloud browser** on a Paseo workspace as native tabs, not as an iframe of the target site, and not as widgets inside an agent transcript.

It works on **https://app.paseo.sh** and with a headless Docker daemon: the pane iframes Browserbase Session Live View; Go / Back / Reload speak CDP to cloud Chrome.

## Names

| | |
| --- | --- |
| Product | Paseo Browserbase |
| npm name | `paseo-browserbase` |
| Install id | `page-pane` |
| Path | `plugins/page-pane` |
| Paseo tab | Browser Base **group** |
| URL inside a group | **page** |

Keep the install id. Changing it orphans the loaded plugin.

## Model

Groups belong to the **workspace**. Agents **link** to groups. Many agents may share one group. See [docs/model.md](docs/model.md).

## Surfaces

- Workspace panel **Paseo Browserbase** — a workspace tab. Inside it: **group tabs**, then **page subtabs**, then one live view.
- Agent ⌘K **Open Paseo Browserbase** — opens that workspace tab (so it can sit beside the agent).
- Sidebar item — same nested-tab chrome, no workspace id.

Do not stack groups. The + on the group strip adds a group tab. The + on the page strip adds a page subtab.

## Secrets (daemon only)

Never put these in the client bundle or in logs.

- `~/.paseo/secrets/browserbase-api-key`
- `~/.paseo/secrets/browserbase-project-id` (Eidos, not Greenmark)
- `~/.paseo/secrets/browserbase-context-id` (not the SSO context)

## Reload

```bash
npm run typecheck
paseo plugin reload page-pane
```

Queue (agent cannot call plugin RPCs): append a URL to `~/.paseo/page-pane/queue`. A line that is only a URL starts a group. A line `+ https://…` adds a page to the latest group.

## Out of scope until Paseo instantiates panels per group

Paseo can open one plugin panel titled **Paseo Browserbase**. Group 1 and Group 2 are tabs *inside* that panel, not yet two Paseo workspace tabs. Split (agent | Paseo Browserbase) is Paseo chrome.
