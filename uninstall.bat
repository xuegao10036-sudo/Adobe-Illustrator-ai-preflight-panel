@echo off
chcp 65001 >nul
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.workbuddy.ai.preflight"

echo ============================================
echo   AI Preflight Panel - Uninstall
echo ============================================
echo.
echo Removing: %DEST%
if exist "%DEST%" (
  rmdir /S /Q "%DEST%"
  echo [OK] Extension files removed.
) else (
  echo [INFO] Not installed, nothing to remove.
)

echo.
echo Done. Restart Illustrator.
pause
