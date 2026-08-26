#!/bin/bash
# Roda os testes do carnê no jsc do macOS (sem node).
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
cd "$(dirname "$0")/.."
{ echo 'const hojeISO = () => "2026-08-21";'; cat carne.js scripts/testar-carne.js; } > /tmp/_teste_carne.js
"$JSC" /tmp/_teste_carne.js
