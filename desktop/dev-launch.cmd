@echo off
"%~dp0..\.cache\proxy-venv\Scripts\pythonw.exe" "%~dp0service.py" --data-dir "%LOCALAPPDATA%\Umalytics" --launch-game -- %*
