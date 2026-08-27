#!/usr/bin/env bash

set -euo pipefail

for v in SUNAT_API_CLIENT_ID SUNAT_API_CLIENT_SECRET SUNAT_RUC SUNAT_USER SUNAT_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "⏭  $v not set — SIRE smoke skipped (needs real SIRE credentials)."
    exit 0
  fi
done

export SUNAT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sunat-smoke-sire.XXXXXX")"
trap 'rm -rf "$SUNAT_HOME"' EXIT

PERIODO="${1:-$(date -v-1m +%Y%m 2>/dev/null || date -d 'last month' +%Y%m)}"

echo "→ Building dist/sunat.js..."
bun run scripts/build.ts >/dev/null

FAILED=0
for LIBRO in ventas compras; do
  OUT="$SUNAT_HOME/$LIBRO-$PERIODO.zip"
  echo "→ node dist/sunat.js sire $LIBRO propuesta --periodo $PERIODO --wait --out …/$LIBRO-$PERIODO.zip"
  RESULT=$(node dist/sunat.js -o json sire "$LIBRO" propuesta --periodo "$PERIODO" --wait --out "$OUT" 2>&1 || true)
  echo "$RESULT" | bun -e '
const [libro, out] = process.argv.slice(1);
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) { console.log(`  ${libro}: ✗ ${r.error}`); process.exit(1); }
if (r.state !== "completed" || !r.file) { console.log(`  ${libro}: ✗ ticket ${r.numTicket ?? "?"} ended as ${r.state ?? "unknown"} (${r.statusDesc ?? ""})`); process.exit(1); }
const bytes = await Bun.file(out).arrayBuffer();
const head = new Uint8Array(bytes.slice(0, 2));
if (head[0] !== 0x50 || head[1] !== 0x4b) { console.log(`  ${libro}: ✗ ticket ${r.numTicket}: downloaded ${bytes.byteLength} bytes but not a ZIP`); process.exit(1); }
console.log(`  ${libro}: ✓ ticket ${r.numTicket} → ZIP, ${bytes.byteLength} bytes`);
' "$LIBRO" "$OUT" || FAILED=1
done

if [ "$FAILED" -eq 0 ]; then
  echo; echo "✅ SIRE PROPUESTA SMOKE PASSED (both proposals downloaded as ZIP)"
else
  echo; echo "❌ SIRE PROPUESTA SMOKE FAILED"; exit 1
fi
