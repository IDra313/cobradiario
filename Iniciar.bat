@echo off
setlocal
cd /d "%~dp0"
title CobraDiario Online
set PORT=8090
set URL=http://127.0.0.1:%PORT%

echo ==============================================
echo    CobraDiario - Gestor de cobranza (online)
echo ==============================================
echo.

where node >nul 2>nul && goto run_node
if exist "C:\Users\ARCEU\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" goto run_bundled
echo No se encontro Node.js. Instalalo desde https://nodejs.org
pause
goto :eof

:run_node
start "" "%URL%"
node servidor.js
goto :eof

:run_bundled
start "" "%URL%"
"C:\Users\ARCEU\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" servidor.js
goto :eof
