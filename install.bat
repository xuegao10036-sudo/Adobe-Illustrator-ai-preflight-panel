@echo off
chcp 65001 >nul
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.workbuddy.ai.preflight"

echo ============================================
echo   AI Preflight Panel Installer
echo ============================================
echo.
echo [1/2] Copying extension files...
echo       Target: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
xcopy "%~dp0*" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo [ERROR] Copy failed. Try running as administrator.
  pause
  exit /b 1
)

echo [2/2] Enabling CEP debug mode (unsigned extensions)...
for %%V in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

echo.
echo Done. Next steps:
echo   1. Restart Adobe Illustrator
echo   2. Menu: Window -^> Extensions -^> 印前检查-雪糕
echo.
pause
