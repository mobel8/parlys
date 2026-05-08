@echo off
cd /d %~dp0
node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit > tsc-out.txt 2>&1
echo DONE %errorlevel% >> tsc-out.txt
