#!/usr/bin/env bash
# Pack plugin tarballs and copy the stable catalog into dist/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${ROOT}/dist"
rm -rf "${DIST}"
mkdir -p "${DIST}"

stamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
python3 - "${ROOT}/catalog.json" "${DIST}/catalog.json" "${stamp}" <<'PY'
import json, sys
src, dest, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
catalog = json.load(open(src))
catalog["updatedAt"] = stamp
json.dump(catalog, open(dest, "w"), indent=2)
open(dest, "a").write("\n")
print("catalog", catalog.get("release"), stamp)
for plugin in catalog.get("plugins") or []:
    print(plugin["id"], plugin["download"])
PY

cp "${ROOT}/install.sh" "${DIST}/install.sh"
chmod +x "${DIST}/install.sh"

python3 - "${ROOT}" "${DIST}" <<'PY'
import json, os, subprocess, sys, tarfile
from pathlib import Path

root = Path(sys.argv[1])
dist = Path(sys.argv[2])
catalog = json.loads((root / "catalog.json").read_text())
for plugin in catalog.get("plugins") or []:
    plugin_id = plugin["id"]
    source = root / plugin["source"]
    if not (source / "paseo-plugin.json").is_file():
        raise SystemExit(f"missing plugin source {source}")
    tarball = dist / f"{plugin_id}.tar.gz"
    with tarfile.open(tarball, "w:gz") as tar:
        tar.add(source, arcname=plugin_id, filter=lambda info: None if "/node_modules/" in f"/{info.name}/" or info.name.endswith(".DS_Store") else info)
    print("packed", tarball.name, tarball.stat().st_size)
PY
ls -lh "${DIST}"
