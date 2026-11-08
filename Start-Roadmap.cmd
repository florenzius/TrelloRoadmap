@echo off
title Kanban Roadmapper
cd /d "%~dp0"
python server.py
if errorlevel 1 pause
