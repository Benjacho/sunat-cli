#!/usr/bin/env bash

set -euo pipefail

export SUNAT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sunat-smoke-tc.XXXXXX")"
trap 'rm -rf "$SUNAT_HOME"' EXIT

FECHA="${1:-$(date -v-7d +%F 2>/dev/null || date -d '7 days ago' +%F)}"

echo "→ Building dist/sunat.js..."
bun run scripts/build.ts >/dev/null

echo "→ node dist/sunat.js tipo-cambio --fecha $FECHA (fresh SUNAT_HOME, no cache)..."
RESULT=$(node dist/sunat.js -o json tipo-cambio --fecha "$FECHA" 2>&1 || true)
echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) {
  console.log("  error:", r.error);
  console.log("\n❌ TIPO-CAMBIO SMOKE FAILED");
  process.exit(1);
}
console.log("  fecha:", r.fecha);
console.log("  compra:", r.compra);
console.log("  venta:", r.venta);
if (typeof r.venta === "number" && r.venta > 0) {
  console.log("\n✅ TIPO-CAMBIO SMOKE PASSED");
  process.exit(0);
}
console.log("\n❌ TIPO-CAMBIO SMOKE FAILED: no venta rate in response");
process.exit(1);
'
