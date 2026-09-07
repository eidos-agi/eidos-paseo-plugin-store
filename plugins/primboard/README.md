# Primboard

Trusted local Paseo plugin: a **board of prims/packs**, not a second viewer.

| | |
| --- | --- |
| In-app | Primboard |
| Install id | `primboard` |
| Path | `plugins/primboard` |

Prim Desktop loads and plays a pack. Primboard catalogs the shelf.

## Surfaces

- Sidebar **Primboard** — columns Memory / Demo / Docs / Brand
- Workspace tab **Primboard**
- ⌘K **Open Primboard**

## Control

Plugin RPCs: `primboard.catalog`, `primboard.select`.

`select` writes Prim Desktop's session (`~/.paseo/prim-desktop/session.json`). Open Prim Desktop to view the queued pack.

## Reload

```bash
npm run typecheck
paseo plugin reload primboard
```
