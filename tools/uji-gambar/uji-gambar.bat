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
echo   6. Uji FOTO ACUAN: pilih hubungan, jenis kelamin hasil, jumlah gambar
echo   7. Buat wajah dari FOTO ACUAN sendiri (satu skenario)
echo   8. Periksa instalasi (tanpa biaya)
echo   9. Simpan kunci OpenRouter di komputer ini (sekali saja, lalu tidak ditanya lagi)
echo   0. Keluar
echo.
set PILIH=
set /p PILIH=Ketik nomor lalu Enter: 
if "%PILIH%"=="1" ( node uji-gambar.js models & echo. & pause & goto menu )
if "%PILIH%"=="2" ( node uji-gambar.js wajah & echo. & pause & goto menu )
if "%PILIH%"=="3" goto lembar
if "%PILIH%"=="4" goto storyboard
if "%PILIH%"=="5" goto kering
if "%PILIH%"=="6" goto acuan
if "%PILIH%"=="7" goto acuansatu
if "%PILIH%"=="8" ( node uji-gambar.js periksa & echo. & pause & goto menu )
if "%PILIH%"=="9" ( node uji-gambar.js kunci & echo. & pause & goto menu )
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

:acuan
cls
node uji-gambar.js acuan --tanya
set KODE=%ERRORLEVEL%
echo.
if "%KODE%"=="0" echo Selesai. Buka folder hasil terbaru dan isi lembar-penilaian.md
if "%KODE%"=="2" echo Selesai sebagian: ada gambar yang gagal. Baca laporan.md di folder hasil terbaru.
pause
goto menu

:acuansatu
cls
echo Hubungan yang tersedia: orang_sama, kakak, adik, saudara, ibu, ayah, mirip_bukan_sama
echo DNA diambil dari contoh\dna-C02.json (ubah berkas itu, atau salin untuk DNA lain).
echo.
set ACUAN=
set /p ACUAN=Alamat foto acuan: 
set HUB=
set /p HUB=Hubungan (salah satu dari daftar di atas): 
set CAT=
set /p CAT=Catatan bebas (boleh kosong, tanpa tanda kutip): 
node uji-gambar.js wajah --acuan "%ACUAN:"=%" --hubungan %HUB% --catatan "%CAT:"=%"
set KODE=%ERRORLEVEL%
echo.
if "%KODE%"=="0" echo Selesai. Gambar ada di folder hasil terbaru.
if "%KODE%"=="2" echo Selesai sebagian: ada gambar yang gagal. Baca laporan.md di folder hasil terbaru.
pause
goto menu

:kering
set WAJAH=
set /p WAJAH=Alamat foto wajah (contoh C:\aset\wajah_C02.png): 
node uji-gambar.js storyboard --wajah "%WAJAH:"=%" --kering
echo.
pause
goto menu
