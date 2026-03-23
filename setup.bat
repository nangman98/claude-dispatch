@echo off
setlocal enabledelayedexpansion

echo.
echo   Claude Dispatch Setup (Windows)
echo   ================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Node.js not found. Install it first: https://nodejs.org
    exit /b 1
)

:: Check Claude CLI
where claude >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Claude Code CLI not found. Install it first:
    echo   https://docs.claude.com/en/docs/getting-started
    exit /b 1
)

for /f "tokens=*" %%i in ('where node') do set NODE_PATH=%%i
for /f "tokens=*" %%i in ('where claude') do set CLAUDE_PATH=%%i
echo   Node.js:    %NODE_PATH%
echo   Claude CLI: %CLAUDE_PATH%
echo.

:: Install dependencies
echo   Installing dependencies...
cd /d "%~dp0"
npm install --silent
echo   Done.
echo.

:: Create startup VBS script (runs hidden, no console window)
set VBS_PATH=%~dp0start-hidden.vbs
echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_PATH%"
echo WshShell.Run "cmd /c cd /d ""%~dp0"" && node server.js", 0, False >> "%VBS_PATH%"

:: Add to Task Scheduler
schtasks /query /tn "ClaudeDispatch" >nul 2>&1
if %errorlevel% equ 0 (
    schtasks /delete /tn "ClaudeDispatch" /f >nul 2>&1
)

schtasks /create /tn "ClaudeDispatch" /tr "wscript.exe \"%VBS_PATH%\"" /sc onlogon /rl highest /f >nul 2>&1
if %errorlevel% neq 0 (
    echo   WARNING: Could not create scheduled task. Run as Administrator to enable auto-start.
    echo   You can still start manually: node server.js
) else (
    echo   Auto-start registered (Task Scheduler: ClaudeDispatch)
)

:: Start server now
echo.
echo   Starting server...
start "" wscript.exe "%VBS_PATH%"

:: Wait for server
timeout /t 3 /nobreak >nul

:: Get token
set TOKEN_FILE=%USERPROFILE%\.claude-dispatch-token
if exist "%TOKEN_FILE%" (
    set /p TOKEN=<"%TOKEN_FILE%"
) else (
    set TOKEN=unknown
)

:: Get IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    set LOCAL_IP=!LOCAL_IP: =!
    goto :gotip
)
:gotip

echo.
echo   Claude Dispatch is running!
echo.
echo   Local:   http://localhost:3456?token=%TOKEN%
echo   Network: http://%LOCAL_IP%:3456?token=%TOKEN%
echo.
echo   Open the URL on your phone to get started.
echo   The server auto-starts on login.
echo.
echo   Commands:
echo     Stop:    schtasks /end /tn "ClaudeDispatch"
echo     Remove:  schtasks /delete /tn "ClaudeDispatch" /f
echo     Logs:    type "%~dp0dispatch.log"
echo.
pause
