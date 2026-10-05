@echo off
cd /d "%~dp0"
:menu
cls
echo ============== UJI GAMBAR (5.3b) ==============
echo.
echo   1. Cek kemampuan model gambar (rasio, harga) - tanpa membuat gambar
echo   2. Buat 4 kandidat WAJAH dari DNA
echo   3. Buat LEMBAR 7 sudut dari wajah terpilih
echo   4. Buat STORYBOARD bersih untuk 4 produk sampel
echo   5. Lihat daftar rencana TANPA mengirim (mode kering)
echo   0. Keluar
echo.
set PILIH=
set /p PILIH=Ketik nomor lalu Enter: 
if "%PILIH%"=="1" ( node uji-gambar.js models & echo. & pause & goto menu )
if "%PILIH%"=="2" ( node uji-gambar.js wajah & echo. & pause & goto menu )
if "%PILIH%"=="3" goto lembar
if "%PILIH%"=="4" goto storyboard
if "%PILIH%"=="5" goto kering
if "%PILIH%"=="0" exit /b 0
echo Pilihan tidak dikenal.
pause
goto menu

:lembar
set WAJAH=
set /p WAJAH=Alamat foto wajah terpilih (contoh C:\aset\wajah_C02.png): 
node uji-gambar.js lembar --wajah "%WAJAH:"=%"
echo.
pause
goto menu

:storyboard
set WAJAH=
set /p WAJAH=Alamat foto wajah karakter (contoh C:\aset\wajah_C02.png): 
node uji-gambar.js storyboard --wajah "%WAJAH:"=%"
echo.
pause
goto menu

:kering
set WAJAH=
set /p WAJAH=Alamat foto wajah (contoh C:\aset\wajah_C02.png): 
node uji-gambar.js storyboard --wajah "%WAJAH:"=%" --kering
echo.
pause
goto menu
