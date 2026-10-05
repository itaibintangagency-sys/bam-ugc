@echo off
cd /d "%~dp0"
echo PEREKAM LAYAR FLOW: memandu kamu membuka tiap layar, lalu memotret daftar tombolnya.
echo Tidak mengklik apa pun dan tidak menekan generate. Jendela Chrome khusus harus sudah terbuka di Flow.
echo.
node src/index.js recon
echo.
echo Kirim berkas .json dari folder recon (yang terbaru) ke Claude.
pause
