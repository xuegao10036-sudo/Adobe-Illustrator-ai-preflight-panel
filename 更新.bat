@echo off
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.workbuddy.ai.preflight"
set "FAIL="

echo ============================================
echo   AI Preflight Panel  -  Update (files only)
echo ============================================
echo.
echo from : %~dp0
echo to   : %DEST%
echo.
if not exist "%DEST%" echo       Not installed yet. Run the install script first.
if not exist "%DEST%" pause
if not exist "%DEST%" exit /b 1

xcopy "%~dp0CSXS" "%DEST%\CSXS" /E /I /Y /Q >nul
xcopy "%~dp0css"  "%DEST%\css"  /E /I /Y /Q >nul
xcopy "%~dp0js"   "%DEST%\js"   /E /I /Y /Q >nul
xcopy "%~dp0jsx"  "%DEST%\jsx"  /E /I /Y /Q >nul
copy /Y "%~dp0index.html" "%DEST%\index.html" >nul
if errorlevel 1 set "FAIL=1"
if not exist "%DEST%\js\main.js" set "FAIL=1"
if not exist "%DEST%\jsx\preflight.jsx" set "FAIL=1"
if defined FAIL echo       FAILED - check the folder path and file permissions.
if not defined FAIL echo       OK - files updated.
echo.
echo   NEXT : restart Adobe Illustrator, then reopen the panel
echo.
pause
if defined FAIL exit /b 1
exit /b 0
