@echo off
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.workbuddy.ai.preflight"
set "FAIL="

echo ============================================
echo   AI Preflight Panel  -  Install
echo ============================================
echo.
echo [1/3] Copy files
echo       from : %~dp0
echo       to   : %DEST%
echo.
if not exist "%DEST%" mkdir "%DEST%"
xcopy "%~dp0*" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 set "FAIL=1"
if not exist "%DEST%\CSXS\manifest.xml" set "FAIL=1"
if not exist "%DEST%\js\main.js" set "FAIL=1"
if not exist "%DEST%\jsx\preflight.jsx" set "FAIL=1"
if defined FAIL echo       FAILED - see TROUBLESHOOTING below.
if not defined FAIL echo       OK - files copied.

echo.
echo [2/3] Enable CEP debug mode (required for unsigned extensions)
for /l %%V in (9,1,14) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo       OK - PlayerDebugMode set to 1 for CSXS 9 to 14.

echo.
echo [3/3] Done.
echo.
echo   NEXT : restart Adobe Illustrator
echo          Menu: Window -^> Extensions -^> the preflight panel
echo.

if not defined FAIL echo All done. You can close this window.
if defined FAIL echo ------------------------------------------------------------
if defined FAIL echo   TROUBLESHOOTING
if defined FAIL echo   1. Extract the ZIP first, then run this file from the
if defined FAIL echo      extracted folder. Do NOT run it from inside the ZIP.
if defined FAIL echo   2. Avoid Chinese characters or spaces in the folder path.
if defined FAIL echo      Example: put the folder in D:\ailight first.
if defined FAIL echo   3. If this file is blocked: right-click it, Properties,
if defined FAIL echo      tick "Unblock" at the bottom, OK, then run again.
if defined FAIL echo   4. Last resort: right-click, "Run as administrator".
if defined FAIL echo ------------------------------------------------------------
echo.
pause
if defined FAIL exit /b 1
exit /b 0
