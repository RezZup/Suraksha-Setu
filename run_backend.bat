@echo off
cd /d "d:\ProjectsGit\Suraksha Setu\backend"
"d:\ProjectsGit\Suraksha Setu\.venv\Scripts\pip.exe" install "fastapi-limiter==0.1.6" --quiet --force-reinstall
"d:\ProjectsGit\Suraksha Setu\.venv\Scripts\python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
