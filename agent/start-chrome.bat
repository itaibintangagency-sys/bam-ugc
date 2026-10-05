@echo off
cd /d "%~dp0"
REM Membuka Chrome KHUSUS (profil terpisah) dengan port kontrol lokal.
REM Opsi tambahan menjaga halaman tetap digambar walaupun jendela Chrome tertutup jendela lain,
REM supaya agent tetap melihat video baru. Berlaku hanya bila Chrome khusus ini dimulai dari awal
REM (tutup dulu semua jendela Chrome khusus sebelum menjalankan berkas ini).
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
start "" %CHROME% --remote-debugging-port=9222 --user-data-dir="C:\flow-agent-profile" --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling https://flow.google.com
echo Chrome khusus dibuka. Login Google manual, buka project Flow, lalu jalankan 1-doctor.bat
echo Jangan maximize jendela dan jangan ubah ukurannya selama agent berjalan.
pause
