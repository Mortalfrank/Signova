@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
notepad.exe .env
