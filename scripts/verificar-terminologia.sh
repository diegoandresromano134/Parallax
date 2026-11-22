#!/usr/bin/env bash
# ==========================================================================
# PARALLAX · Verificación de terminología
# --------------------------------------------------------------------------
# 1) Términos RESTRINGIDOS: no pueden aparecer en ninguna parte del código,
#    la base de datos ni la interfaz. Para administración y soporte
#    corporativo se usa siempre «Asesoría» o «Gestoría».
# 2) Vocabulario de relación laboral: el sistema refleja una relación
#    estrictamente comercial (locación de servicios); estos términos no
#    deben usarse para describir el vínculo con locatarios o sus personas.
#
# Los patrones se guardan codificados en base64 para que el propio
# repositorio no contenga las palabras restringidas.
#
# Uso:  bash scripts/verificar-terminologia.sh      (sale con 1 si hay hallazgos)
# ==========================================================================
set -u
export LC_ALL=C.UTF-8

cd "$(dirname "$0")/.."

RESTRINGIDOS="$(printf '%s' 'Z2VyZW5jaWFtaWVudG98Z2VyZW5jaWFyfGF1ZGl0b3JbacOtXWF8YXVkaXRhcnxmaXNjYWxpemFjaVtvw7NdbnxmaXNjYWxpemFy' | base64 -d)"
LABORALES="$(printf '%s' 'ZW1wbGVhZFtvYV1zP3xlbXBsZWFkb3J8c3VlbGRvfHNhbGFyaXxzdWJvcmRpbmFjaXxyZWxhY2lbb8OzXW4gZGUgZGVwZW5kZW5jaWF8am9ybmFkYSBsYWJvcmFsfHByZXNlbnRpc21vfG5bb8OzXW1pbmF8ZmljaGFqZXxob3JhcmlvIGxhYm9yYWw=' | base64 -d)"

INCLUDES=(--include='*.html' --include='*.js' --include='*.css' --include='*.json' --include='*.md' --include='*.txt' --include='*.svg')
status=0

echo "▸ Términos restringidos"
if grep -rniE "${INCLUDES[@]}" --exclude-dir=.git "$RESTRINGIDOS" . ; then
  echo "✖ Se encontraron términos restringidos. Reemplazalos por «Asesoría» o «Gestoría»."
  status=1
else
  echo "✔ Sin coincidencias."
fi

echo
echo "▸ Vocabulario de relación laboral"
if grep -rniE "${INCLUDES[@]}" --exclude-dir=.git "$LABORALES" . ; then
  echo "✖ Revisá estos textos: el vínculo con locatarios es estrictamente comercial."
  status=1
else
  echo "✔ Sin coincidencias."
fi

exit $status
