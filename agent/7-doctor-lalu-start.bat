@echo off
cd /d "%~dp0"
echo Pemeriksaan dulu, lalu agent dijalankan bila semua lolos.
node src/index.js doctor
if errorlevel 1 (
  echo Ada pemeriksaan yang gagal. Agent TIDAK dijalankan.
  pause
  exit /b 1
)
call 2-start-agent.bat
