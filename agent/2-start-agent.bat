@echo off
cd /d "%~dp0"
echo Agent produksi ONLINE berjalan. Tutup jendela ini atau tekan Ctrl+C untuk berhenti.
:ulang
node src/index.js start
echo Agent berhenti. Mencoba lagi dalam 15 detik... (tutup jendela untuk berhenti total)
timeout /t 15 /nobreak >nul
goto ulang
