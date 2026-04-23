@echo off
echo Stopping server on port 3007...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3007 " ^| findstr "LISTENING"') do (
    echo Killing PID %%a
    taskkill /F /PID %%a
)
timeout /t 2 /nobreak >nul
echo Starting server...
cd /d "%~dp0server"
call npm run dev
