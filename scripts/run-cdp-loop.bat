@echo off
for /L %%i in (1,1,3) do (
  echo ===============================
  echo  RUN %%i / 3
  echo ===============================
  node scripts\run-cdp-hover-test.js
  if errorlevel 1 (
    echo !!! RUN %%i FAILED
    exit /b 1
  )
)
echo.
echo === ALL 3 RUNS PASSED ===
