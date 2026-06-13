@echo off
REM Converts non-OGG audio to OGG, then regenerates config.js
REM Double-click this after adding/removing sounds.

echo.
echo ========================================
echo    SOUNDBOARD UPDATE
echo ========================================
echo.

REM Step 1: Convert audio to OGG (if ffmpeg is available)
ffmpeg -version >nul 2>&1
if %errorlevel% equ 0 (
    echo [1/2] Converting audio to OGG...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\convert-to-mp3.ps1"
) else (
    echo [1/2] ffmpeg not found -- skipping audio conversion
)
echo.

REM Step 2: Regenerate config.js
echo [2/2] Generating config.js...
node --version >nul 2>&1
if %errorlevel% equ 0 (
    node "%~dp0scripts\generate-config.js"
    goto done
)

powershell -Command "exit" >nul 2>&1
if %errorlevel% equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\generate-config.ps1"
    goto done
)

echo ERROR: Neither Node.js nor PowerShell found
echo.
timeout /t 10 >nul
exit /b 1

:done
echo.
echo ========================================
echo    DONE! Soundboard is up to date.
echo ========================================
echo.
timeout /t 5 >nul
