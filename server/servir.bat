@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 servir.py %*) || (python servir.py %*)
pause
