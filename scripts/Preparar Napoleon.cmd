@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js LTS desde la pagina que se abrira y vuelve a abrir este archivo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo Falta npm. Reinstala Node.js LTS con sus componentes predeterminados.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
  start "" "%ProgramFiles%\Tailscale\tailscale-ipn.exe"
) else (
  echo Instala Tailscale y entra con la misma cuenta de tu telefono y tu otro equipo.
  start "" "https://tailscale.com/download"
)
node scripts/mobile-setup.mjs ensure-codex --login
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts/mobile-setup.mjs setup
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts/mobile-setup.mjs open
if errorlevel 1 (
  pause
  exit /b 1
)
echo Napoleon esta preparado. Su direccion privada se activara cuando entres en Tailscale.
pause
