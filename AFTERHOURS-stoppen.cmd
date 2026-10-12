@echo off
cd /d "%~dp0"
echo Supabase wird gestoppt ...
call npx supabase stop
pause
