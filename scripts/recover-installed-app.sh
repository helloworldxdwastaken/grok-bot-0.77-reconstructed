#!/bin/zsh
# Recover YOUR OWN installed Grok Bot.app into recovered/<version>/ for private study.
# The output is upstream material: it is gitignored and must never be committed or shared (see LEGAL.md).
#   asar/    raw app.asar contents (incl. unpacked natives)
#   bundle/  app bundle minus Electron framework, asar and locales
#   pretty/  Prettier-formatted JS/CSS/HTML/JSON
#   native/  arm64 slices, Ghidra project and decompiled C per binary
#
# Env: APP (default /Applications/Grok Bot.app), GHIDRA (ghidra_*_PUBLIC dir), JAVA_HOME (JDK 21).
set -euo pipefail

ROOT=${0:A:h:h}
APP=${APP:-"/Applications/Grok Bot.app"}
GHIDRA=${GHIDRA:?set GHIDRA to the ghidra_*_PUBLIC directory}
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}
export PATH=$JAVA_HOME/bin:$PATH

C="$APP/Contents"
VERSION=$(defaults read "$C/Info" CFBundleShortVersionString)
OUT="$ROOT/recovered/$VERSION"
rm -rf "$OUT" && mkdir -p "$OUT"
cd "$OUT"

npx --yes @electron/asar extract "$C/Resources/app.asar" asar
rsync -a --exclude 'Frameworks/Electron Framework.framework' --exclude 'Resources/app.asar' \
  --exclude 'Resources/app.asar.unpacked' --exclude '*.lproj' "$C/" bundle/

mkdir pretty
(cd asar && find dist package.json \( -name '*.js' -o -name '*.cjs' -o -name '*.mjs' -o -name '*.css' \
  -o -name '*.html' -o -name '*.json' \) -not -path '*/locales/*' -print0 | rsync -a --from0 --files-from=- . ../pretty/)
(cd pretty && npx --yes prettier@3.6.2 --no-config --log-level warn --write .)

# tree-sitter addons are upstream OSS; skipped.
mkdir -p native/bin native/ghidra-project
for f in "$C/MacOS/"* "$C/Helpers/"*.app/Contents/MacOS/* asar/dist/native/* asar/dist/deps/**/*.node; do
  n=${${f:t}// /_}
  [[ $n == tree[-_]sitter* ]] && continue
  lipo "$f" -thin arm64 -output native/bin/$n 2>/dev/null || cp "$f" native/bin/$n
done
for b in native/bin/*; do
  "$GHIDRA/support/analyzeHeadless" native/ghidra-project "GrokBot-$VERSION" -import "$b" -overwrite \
    -scriptPath "$ROOT/scripts/ghidra" -postScript ExportDecompiled.java "$OUT/native/decompiled" \
    -analysisTimeoutPerFile 1800 2>&1 | grep 'ExportDecompiled ' || true
done

shasum -a 256 "$C/Resources/app.asar" > SHA256SUMS
echo "recovered $VERSION -> $OUT"
