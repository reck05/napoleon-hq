#!/bin/bash
# Double-click this file on the second Mac after downloading Napoleon.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Falta Node.js. Instala la versión LTS desde la página que se abrirá y vuelve a hacer doble clic aquí.'
  open 'https://nodejs.org/en/download'
  read -r -p 'Pulsa Enter para cerrar. ' _napoleon_reply
  exit 1
fi
if [ ! -d node_modules ]; then npm install || exit 1; fi
npm run build || exit 1
if [ -d /Applications/Tailscale.app ]; then
  open -a Tailscale
else
  echo 'Instala Tailscale desde la página que se abrirá. Usa la misma cuenta en los dos equipos y el teléfono.'
  open 'https://tailscale.com/download'
fi
node scripts/mobile-setup.mjs ensure-codex --login || exit 1
node scripts/mobile-setup.mjs setup
napoleon_setup_result=$?
if [ "$napoleon_setup_result" -eq 0 ]; then
  node scripts/mobile-setup.mjs open || exit 1
  echo 'Napoleon está preparado. Entra en Tailscale; la dirección del teléfono se activará automáticamente.'
fi
read -r -p 'Pulsa Enter para cerrar. ' _napoleon_reply
exit "$napoleon_setup_result"
