# Data Connections

The Data tab lists **Data Connections**: named sources you can browse and query. A DSN is one file type of that object, not the product name.

## File types

| `fileType` | On disk | Notes |
|---|---|---|
| `dsn` | `dsns.json`, `*.dsn.json` | Legacy catalog. Array or `{ "dsns": [ ... ] }`. |
| `prim.data-connection` | `data-connection.json` inside a `*.data-connection/` pack, or `*.data-connection.json` | Prim pack. `"format": "prim.data-connection"` is required. |

Env vars, env files, and ASMP-discovered sources still show up as Data Connections with `fileType: "dsn"`.

Same `id` is the same connection. If a DSN is already loaded and a `prim.data-connection` pack with that id appears later, the connection keeps its secret and the file type upgrades to the Prim.

## Pack shape

```
greenmark-warehouse.data-connection/
  index.md
  data-connection.json
```

`data-connection.json` holds identity and pointers (`id`, `name`, `engine`, `role`, `envFile`, `sqlite`). It does not hold passwords. Secrets stay in the env file or in a sqlite path the daemon can read.

RPCs take `connectionId`. `dsnId` is still accepted as an alias. Stored tabs migrate `dsnId` → `connectionId`.
