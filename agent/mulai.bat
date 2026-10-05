@echo off
cd /d "%~dp0"
set "SOURCE=local"
:menu
cls
echo ==================== BA UGC - MENU UTAMA ====================
echo.
echo   1. Siapkan ruang karakter  (SEKALI per project Flow)
echo   2. Ganti project atau akun (setelah berganti akun Google)
echo   3. Tambah produk           (membuat job baru)
echo   4. Jalankan semua antrean
echo   5. Lihat ruang karakter dan antrean
echo   6. Periksa sebelum produksi (doctor)
echo   7. Buka Chrome khusus
echo   8. Database: kirim karakter dan job, lihat antrean, unduh video
echo   9. Jalankan agent ONLINE (mengambil job dari database)
echo   0. Keluar
echo.
set PILIH=
set /p PILIH=Ketik nomor lalu Enter: 
if "%PILIH%"=="1" goto ruang
if "%PILIH%"=="2" goto ganti
if "%PILIH%"=="3" goto tambah
if "%PILIH%"=="4" goto jalan
if "%PILIH%"=="5" goto lihat
if "%PILIH%"=="6" goto cek
if "%PILIH%"=="7" goto chrome
if "%PILIH%"=="8" goto db
if "%PILIH%"=="9" goto online
if "%PILIH%"=="0" goto selesai
echo Pilihan tidak dikenal.
pause
goto menu

:ruang
cls
node src/index.js wizard-room
echo.
pause
goto menu

:ganti
cls
node src/index.js wizard-set
echo.
pause
goto menu

:tambah
cls
node src/index.js wizard-add
echo.
pause
goto menu

:jalan
cls
echo Menjalankan SEMUA job di antrean, satu per satu.
echo Jangan menyentuh mouse dan keyboard di jendela Chrome. Jangan menekan Ctrl+C.
echo.
node src/index.js all
echo.
echo Video ada di folder local\outbox.
pause
goto menu

:lihat
cls
echo ===== RUANG KARAKTER =====
node src/index.js rooms
echo.
echo ===== ANTREAN =====
node src/index.js queue
echo.
pause
goto menu

:cek
cls
echo Pemeriksaan sebelum produksi (hanya membaca, tidak menekan generate)...
node src/index.js doctor
echo.
pause
goto menu

:chrome
call start-chrome.bat
goto menu

:db
cls
echo ================ DATABASE (sementara, sebelum website) ================
echo   a. Kirim karakter dari ruang ke database (admin menandai SIAP)
echo   b. Kirim job lokal baru sebagai satu batch ke antrean database
echo   c. Lihat antrean di database
echo   d. Unduh video hasil dari database
echo   e. Periksa koneksi database dan migrasi (doctor online)
echo   x. Kembali
echo.
set DB=
set /p DB=Ketik huruf lalu Enter: 
if /i "%DB%"=="a" ( node src/index.js staff push-char & echo. & pause & goto db )
if /i "%DB%"=="b" ( node src/index.js staff push-batch & echo. & pause & goto db )
if /i "%DB%"=="c" ( node src/index.js staff queue & echo. & pause & goto db )
if /i "%DB%"=="d" ( node src/index.js staff videos & echo. & pause & goto db )
if /i "%DB%"=="e" ( set "SOURCE=supabase" & node src/index.js doctor & set "SOURCE=local" & echo. & pause & goto db )
if /i "%DB%"=="x" goto menu
echo Pilihan tidak dikenal.
pause
goto db

:online
cls
echo Menjalankan agent ONLINE: mengambil job dari database sampai dihentikan.
echo Jangan menyentuh mouse dan keyboard di jendela Chrome. Untuk berhenti, tekan Ctrl+C SEKALI lalu tunggu job yang sedang berjalan selesai.
echo.
set "SOURCE=supabase"
node src/index.js start
set "SOURCE=local"
echo.
pause
goto menu

:selesai
exit /b 0
