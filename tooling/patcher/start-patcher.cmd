@echo off
rem Double-click to launch the Readest mod patcher in your browser.
cd /d "%~dp0"
start "" http://localhost:8787
echo Starting patcher at http://localhost:8787  (close this window to stop)
node server.mjs
