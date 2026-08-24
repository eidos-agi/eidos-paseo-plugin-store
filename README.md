# Eidos Paseo Plugin Store

Public catalog and installer for Eidos [Paseo](https://paseo.sh) plugins.

In the Paseo app the surface is **Eidos Plugin Store**. Runtime id stays `eidos-ppm`.

Paseo plugins are trusted local code. Install only this repo, or source you have read.

## Install on your Paseo

Paseo must already be running with **Settings → Plugins → Enable plugins** on. This installer does not flip that switch.

```bash
curl -fsSL https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/install.sh | bash
```

That URL does not change. Each release replaces the file behind it.

Then in Paseo: **⌘K** → **Open Eidos Plugin Store**. Install Volta, Browserbase, Data, or Prim Desktop from there.

From a clone:

```bash
git clone https://github.com/eidos-agi/eidos-paseo-plugin-store.git
cd eidos-paseo-plugin-store
./install.sh
```

## Links that do not change

| What | URL |
| --- | --- |
| Latest catalog | https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/catalog.json |
| Latest installer | https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/install.sh |
| Latest store plugin | https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/eidos-ppm.tar.gz |
| Catalog on `main` | https://raw.githubusercontent.com/eidos-agi/eidos-paseo-plugin-store/main/catalog.json |
| Repo | https://github.com/eidos-agi/eidos-paseo-plugin-store |

`catalog.json` is the public artifact. Read it in the GitHub UI, or `curl` the latest URL. Each plugin listed there has its own `download` field; those URLs also stay put (`…/releases/latest/download/<id>.tar.gz`).

## Update

In **Eidos Plugin Store**, press **Update** on a plugin when a newer catalog version is out.

Or re-run the installer:

```bash
curl -fsSL https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/install.sh | bash
./install.sh volta
```

From a git clone: `git pull`, then `./install.sh` and `paseo plugin reload <id>`.

## Catalog plugins

| Id | In-app name |
| --- | --- |
| `eidos-ppm` | Eidos Plugin Store |
| `volta` | Volta |
| `page-pane` | Paseo Browserbase |
| `data-warehouse` | Data |
| `prim-desktop` | Prim Desktop |

Do not change those runtime ids. Changing an id orphans existing installs.

## License

[MIT](LICENSE)
