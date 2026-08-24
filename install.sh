#!/usr/bin/env bash
# Install or update Eidos Paseo Plugin Store from a URL that does not change.
#   curl -fsSL https://github.com/eidos-agi/eidos-paseo-plugin-store/releases/latest/download/install.sh | bash
#   ./install.sh              # store only
#   ./install.sh --update     # re-fetch the store tarball and reload
#   ./install.sh volta        # install/update one catalog plugin
set -euo pipefail

REPO="eidos-agi/eidos-paseo-plugin-store"
LATEST_BASE="https://github.com/${REPO}/releases/latest/download"
RAW_CATALOG="https://raw.githubusercontent.com/${REPO}/main/catalog.json"
USER_AGENT="Eidos-Paseo-Plugin-Store/0.1.1"

plugin_id="${1:-eidos-ppm}"
if [ "${plugin_id}" = "--update" ]; then
  plugin_id="eidos-ppm"
  do_update=1
else
  do_update=0
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Need $1 on PATH." >&2
    exit 1
  }
}

need curl
need tar
need npm
need paseo
need rsync

if ! paseo plugin ls >/dev/null 2>&1; then
  echo "Paseo CLI cannot talk to a daemon. Start Paseo, then run this again." >&2
  exit 1
fi

paseo_home() {
  local reported
  reported="$(paseo daemon status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("home") or "")' 2>/dev/null || true)"
  if [ -n "${reported}" ]; then
    printf '%s\n' "${reported}"
    return
  fi
  if [ "${HOME##*/}" = ".paseo" ]; then
    printf '%s\n' "${HOME}"
    return
  fi
  printf '%s\n' "${HOME}/.paseo"
}

STORE_ROOT="$(paseo_home)/eidos-plugin-store"
CACHE="${STORE_ROOT}/plugins"
mkdir -p "${CACHE}"

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
local_plugin=""
if [ -n "${here}" ] && [ -f "${here}/plugins/${plugin_id}/paseo-plugin.json" ]; then
  local_plugin="${here}/plugins/${plugin_id}"
fi

fetch_catalog() {
  curl -fsSL -A "${USER_AGENT}" "${LATEST_BASE}/catalog.json" 2>/dev/null || \
    curl -fsSL -A "${USER_AGENT}" "${RAW_CATALOG}"
}

download_url_for() {
  local id="$1"
  python3 -c '
import json, sys
catalog = json.load(sys.stdin)
wanted = sys.argv[1]
for plugin in catalog.get("plugins") or []:
    if plugin.get("id") == wanted and plugin.get("download"):
        print(plugin["download"])
        raise SystemExit(0)
print("https://github.com/'"${REPO}"'/releases/latest/download/%s.tar.gz" % wanted)
' "${id}"
}

install_from_dir() {
  local dir="$1"
  (cd "${dir}" && npm install)
  local id current
  id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "${dir}/paseo-plugin.json")"
  if [ -z "${id}" ]; then
    echo "paseo-plugin.json is missing id" >&2
    exit 1
  fi
  current="$(paseo plugin ls --json | python3 -c '
import json, sys
wanted = sys.argv[1]
for row in json.load(sys.stdin):
    if row.get("id") == wanted:
        print(row.get("path") or "")
        break
' "${id}")"
  if [ -n "${current}" ]; then
    if [ "${current}" != "${dir}" ]; then
      rsync -a --delete --exclude node_modules "${dir}/" "${current}/"
      (cd "${current}" && npm install)
    fi
    paseo plugin reload "${id}"
    echo "Updated ${id} at ${current}"
  else
    paseo plugin install "${dir}"
    echo "Installed ${id} from ${dir}"
  fi
}

if [ -n "${local_plugin}" ] && [ "${do_update}" -eq 0 ]; then
  install_from_dir "${local_plugin}"
  echo "Open ⌘K → Open Eidos Plugin Store"
  exit 0
fi

catalog_json="$(fetch_catalog || true)"
url=""
if [ -n "${catalog_json}" ]; then
  url="$(printf '%s' "${catalog_json}" | download_url_for "${plugin_id}")"
fi
if [ -z "${url}" ]; then
  url="${LATEST_BASE}/${plugin_id}.tar.gz"
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
if ! curl -fsSL -A "${USER_AGENT}" "${url}" -o "${work}/${plugin_id}.tar.gz"; then
  echo "Could not download ${url}" >&2
  echo "Clone instead: git clone https://github.com/${REPO}.git && cd eidos-paseo-plugin-store && ./install.sh" >&2
  exit 1
fi
tar -xzf "${work}/${plugin_id}.tar.gz" -C "${work}"
extracted="${work}/${plugin_id}"
if [ ! -f "${extracted}/paseo-plugin.json" ]; then
  extracted="$(find "${work}" -name paseo-plugin.json -type f | head -n 1 | xargs dirname)"
fi
if [ ! -f "${extracted}/paseo-plugin.json" ]; then
  echo "Tarball did not contain a Paseo plugin." >&2
  exit 1
fi

version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version","latest"))' "${extracted}/package.json")"
dest="${CACHE}/${plugin_id}/${version}"
rm -rf "${dest}"
mkdir -p "${dest}"
cp -R "${extracted}/." "${dest}/"
install_from_dir "${dest}"
echo "Open ⌘K → Open Eidos Plugin Store"
echo "Catalog: ${LATEST_BASE}/catalog.json"
