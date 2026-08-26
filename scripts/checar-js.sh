#!/bin/bash
# Checagem de SINTAXE (não executa): embrulha o arquivo em new Function().
# O jsc do macOS compila o corpo; erro de sintaxe estoura com linha.
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
ok=0
# Sem argumentos = confere TODOS os .js do app (chamar sem args e "passar"
# era mentira: o laço nem rodava e o exit era 0).
ARQS=("$@")
if [ ${#ARQS[@]} -eq 0 ]; then ARQS=(config.js ui.js store.js carne.js pdf.js espelho.js vendas.js caixa.js cadastros.js cronograma.js apresentacao.js contratos.js omie.js app.js sw.js); fi
for f in "${ARQS[@]}"; do
  if python3 - "$f" <<'PY' > /tmp/_wrap.js
import sys, json
src = open(sys.argv[1], encoding='utf-8').read()
print('try { new Function(' + json.dumps(src) + '); print("SINTAXE_OK") } catch (e) { print("ERRO: " + e) }')
PY
  then
    r=$("$JSC" /tmp/_wrap.js 2>&1)
    if [[ "$r" == "SINTAXE_OK" ]]; then echo "✓ $f"; else echo "✗ $f — $r"; ok=1; fi
  fi
done
exit $ok
