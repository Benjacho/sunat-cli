#!/usr/bin/env bash
# Smoke test: list filed declarations through SOL and download one constancia
# with the build that ships.
#
# The visor lives on ww1.sunat.gob.pe and its session cookie is minted only by
# the SOL menu hop, so this exercises the whole chain: Clave SOL login in the
# local browser, the menu click, the in-page fetches, and the PDF download.
# It runs dist/sunat.js under node, like the other smokes, because that is the
# artifact users get.
#
# Run from packages/cli directory:
#   bash scripts/smoke-declaraciones.sh [DD/MM/YYYY desde] [DD/MM/YYYY hasta]
# Or via npm script:
#   bun smoke:declaraciones
#
# Needs real Clave SOL credentials in SUNAT_RUC / SUNAT_USER / SUNAT_PASSWORD
# and agent-browser installed. Skips (exit 0) without them. Prints counts and
# form codes only: no RUC, no número de orden, no dates of real filings.

set -euo pipefail

if [[ -z "${SUNAT_RUC:-}" || -z "${SUNAT_USER:-}" || -z "${SUNAT_PASSWORD:-}" ]]; then
  echo "↷ SUNAT_RUC / SUNAT_USER / SUNAT_PASSWORD not set; skipping declaraciones smoke."
  exit 0
fi
if ! command -v agent-browser >/dev/null 2>&1; then
  echo "↷ agent-browser not installed; skipping declaraciones smoke."
  exit 0
fi

# A scratch state root so the login and any cached session belong to this run
# and are deleted with it.
export SUNAT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/sunat-smoke-decl.XXXXXX")"
trap 'rm -rf "$SUNAT_HOME"' EXIT

HASTA="${2:-$(date +%d/%m/%Y)}"
DESDE="${1:-$(date -v-90d +%d/%m/%Y 2>/dev/null || date -d '90 days ago' +%d/%m/%Y)}"

echo "→ Building dist/sunat.js..."
bun run scripts/build.ts >/dev/null

echo "→ node dist/sunat.js declaraciones list (last ~90 days)..."
# Errors are reported as JSON on stderr; capture both streams so the verdict
# below reads the real answer rather than an empty string.
LIST=$(node dist/sunat.js -o json declaraciones list --desde "$DESDE" --hasta "$HASTA" 2>&1 || true)
PICK=$(echo "$LIST" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) {
  console.error("  error:", r.error, r.code ?? "");
  process.exit(1);
}
const forms = [...new Set(r.items.map((i) => i.formulario))].sort();
console.error("  rows:", r.count, " forms:", forms.join(" ") || "(none)");
const decl = r.items.find((i) => i.kind === "declaracion" && i.formulario !== "0709" && i.formulario !== "0710");
if (!decl) { console.error("  no monthly declaration in range; list verified, constancia skipped"); process.exit(0); }
console.log(`${decl.numOrden} ${decl.formulario}`);
') || { echo; echo "❌ DECLARACIONES SMOKE FAILED (list)"; exit 1; }

if [[ -z "$PICK" ]]; then
  echo; echo "✅ DECLARACIONES SMOKE PASSED (list only)"; exit 0
fi

NUM_ORDEN="${PICK% *}"
FORM="${PICK#* }"
OUT="$SUNAT_HOME/constancia.pdf"
echo "→ node dist/sunat.js declaraciones constancia <numOrden> --formulario $FORM..."
RESULT=$(node dist/sunat.js -o json declaraciones constancia "$NUM_ORDEN" --formulario "$FORM" --out "$OUT" 2>&1 || true)
echo "$RESULT" | bun -e '
const r = JSON.parse(await Bun.stdin.text());
if (r.success === false) { console.log("  error:", r.error, r.code ?? ""); process.exit(1); }
console.log("  bytes:", r.bytes);
' || { echo; echo "❌ DECLARACIONES SMOKE FAILED (constancia)"; exit 1; }

if head -c 5 "$OUT" | grep -q '%PDF-'; then
  echo; echo "✅ DECLARACIONES SMOKE PASSED"
else
  echo; echo "❌ DECLARACIONES SMOKE FAILED: downloaded file is not a PDF"; exit 1
fi
