@echo off
cd /d "%~dp0"
echo Analisa Flow: membandingkan tampilan Flow sekarang dengan baseline.
echo (Tidak menekan generate atau unduh.)
set /p SIMPAN=Simpan sebagai BASELINE baru? (y/n): 
if /i "%SIMPAN%"=="y" (node src/index.js analyze --save-baseline) else (node src/index.js analyze)
echo.
pause
