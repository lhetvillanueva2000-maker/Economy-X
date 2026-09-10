#!/usr/bin/env bash
# ============================================================
#  EconomyX — version bump
#
#  Usage:  tools/bump_version.sh 2.8 2.9
#
#  The version lives in five places and they must never drift apart:
#    1. the two pack folder names        EconomyX_v<V>_BP / _RP
#    2. both manifest header names       "EconomyX v<V> [BP]"
#    3. both manifest header versions    [major, minor, 0]
#    4. both manifest MODULE versions
#    5. the sibling-pack dependency version in each manifest
#  plus every reference in README.md.
#
#  What it deliberately does NOT touch:
#    - the @minecraft/server and @minecraft/server-ui dependency strings.
#      Those are SCRIPTING API versions. "2.6.0" there has nothing to do with
#      the pack being called 2.6, and moving it would break the pack.
#    - the pack header/module UUIDs. Those must stay fixed forever, or an
#      update installs as a second copy of the mod instead of replacing it.
# ============================================================
set -euo pipefail

OLD="${1:-}"; NEW="${2:-}"
if [[ -z "$OLD" || -z "$NEW" ]]; then
  echo "usage: $0 <old-version> <new-version>   e.g. $0 2.8 2.9" >&2
  exit 1
fi
[[ -d "EconomyX_v${OLD}_BP" ]] || { echo "no EconomyX_v${OLD}_BP here — run from the repo root" >&2; exit 1; }

git mv "EconomyX_v${OLD}_BP" "EconomyX_v${NEW}_BP"
git mv "EconomyX_v${OLD}_RP" "EconomyX_v${NEW}_RP"

python3 - "$OLD" "$NEW" <<'PY'
import json, sys
old, new = sys.argv[1], sys.argv[2]
oldv = [int(old.split(".")[0]), int(old.split(".")[1]), 0]
newv = [int(new.split(".")[0]), int(new.split(".")[1]), 0]

for pack in ("BP", "RP"):
    p = f"EconomyX_v{new}_{pack}/manifest.json"
    m = json.load(open(p)); h = m["header"]
    h["name"] = h["name"].replace(f"v{old}", f"v{new}")
    h["description"] = h["description"].replace(f"v{old}", f"v{new}")
    assert h["version"] == oldv, f"{p}: expected {oldv}, found {h['version']}"
    h["version"] = newv
    for mod in m["modules"]:
        if mod["version"] == oldv: mod["version"] = newv
    # Only the sibling-pack dep carries OUR version; module_name deps are API
    # versions and must not move.
    for dep in m.get("dependencies", []):
        if "uuid" in dep and dep.get("version") == oldv: dep["version"] = newv
    json.dump(m, open(p, "w"), indent=2)
    print(f"  {h['name']}  v{h['version']}")

s = open("README.md").read()
for a, b in [(f"**Current version:** {old}", f"**Current version:** {new}"),
             (f"EconomyX_v{old}.mcaddon",    f"EconomyX_v{new}.mcaddon"),
             (f"EconomyX v{old} [BP]",       f"EconomyX v{new} [BP]"),
             (f"EconomyX v{old} [RP]",       f"EconomyX v{new} [RP]"),
             (f"EconomyX_v{old}_BP",         f"EconomyX_v{new}_BP"),
             (f"EconomyX_v{old}_RP",         f"EconomyX_v{new}_RP")]:
    s = s.replace(a, b)
open("README.md", "w").write(s)
print("  README.md updated")
PY

echo
echo "Now add a '## ${NEW}' section at the top of CHANGELOG.md describing what"
echo "changed. That section is the GitHub release description for this version."
