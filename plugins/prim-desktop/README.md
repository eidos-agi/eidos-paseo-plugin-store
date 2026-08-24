# Prim Desktop

Trusted local Paseo plugin that loads and controls **Prims** (pack files) on this daemon.

| | |
| --- | --- |
| In-app | Prim Desktop |
| Product | Prims Desktop |
| Install id | `prim-desktop` |
| Path | `plugins/prim-desktop` |

The pack is the file. This plugin is a surface + connector. It is not a Prim.

## Surfaces

- Sidebar **Prim Desktop** — memory rail + prim-viewer stage
- Workspace tab **Prim Desktop** — same desk beside an agent
- ⌘K **Open Prim Desktop**

## Control

Plugin RPCs (pane): `prim.catalog`, `prim.open`, `prim.tab`, `prim.admit`, `prim.status`, `prim.files`, `prim.face`, `prim.read`.

Agents cannot call plugin RPCs. Append to `~/.paseo/prim-desktop/queue`:

```
open house.opff
tab face
```

`open` from the queue only admits packs already in memory. The human opens demos, then **Admit to memory**.

## Reload

```bash
npm run typecheck
paseo plugin reload prim-desktop
```
