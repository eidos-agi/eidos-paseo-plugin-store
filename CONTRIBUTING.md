# Contributing

This repo is the public catalog for Eidos Paseo plugins.

1. Change plugin source under `plugins/<id>/`.
2. Bump that plugin's `package.json` `version` and the matching entry in `catalog.json`.
3. Keep runtime ids stable (`eidos-ppm`, `volta`, `page-pane`, `data-warehouse`, `prim-desktop`).
4. Tag `vX.Y.Z`. GitHub Actions packs `catalog.json`, `install.sh`, and `<id>.tar.gz` onto the release. The latest-download URLs stay the same.
