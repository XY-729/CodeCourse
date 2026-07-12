@echo off
set "CODECOURSE_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
start "" "%~dp0dist-desktop\win-unpacked\CodeCourse.exe"
