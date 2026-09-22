@echo off
chcp 65001 >nul
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.workbuddy.ai.preflight"

echo ============================================
echo   AI Preflight Panel - Update (files only)
echo ============================================
echo.
echo Target: %DEST%
if not exist "%DEST%" (
  echo [ERROR] Extension not installed yet. Run install.bat first.
  pause
  exit /b 1
)

xcopy "%~dp0CSXS" "%DEST%\CSXS" /E /I /Y /Q >nul
xcopy "%~dp0css"  "%DEST%\css"  /E /I /Y /Q >nul
xcopy "%~dp0js"   "%DEST%\js"   /E /I /Y /Q >nul
xcopy "%~dp0jsx"  "%DEST%\jsx"  /E /I /Y /Q >nul
copy /Y "%~dp0index.html" "%DEST%\index.html" >nul
if errorlevel 1 (
  echo [ERROR] Copy failed.
  pause
  exit /b 1
)

echo Done. Restart Illustrator, then reopen the panel.
pause
