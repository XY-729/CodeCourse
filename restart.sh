#!/bin/bash
set -e

PROJECT_DIR="/home/xiyuan729/github-project-learner"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "=== 停止旧进程 ==="
pkill -f "uvicorn app.main:app" 2>/dev/null && echo "后端已停止" || echo "后端未在运行"
pkill -f "vite" 2>/dev/null && echo "前端已停止" || echo "前端未在运行"
sleep 1

echo "=== 启动后端 ==="
cd "$BACKEND_DIR"
source .venv/bin/activate
nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
echo "后端 PID: $!"
deactivate 2>/dev/null || true

echo "=== 启动前端 ==="
cd "$FRONTEND_DIR"
nohup npm run dev > /tmp/frontend.log 2>&1 &
echo "前端 PID: $!"

sleep 2
echo "=== 检查状态 ==="
sleep 1
curl -s http://localhost:8000/api/settings/llm > /dev/null 2>&1 && echo "后端 OK (http://localhost:8000)" || echo "后端未就绪，查看 /tmp/backend.log"
curl -s http://localhost:5173 > /dev/null 2>&1 && echo "前端 OK (http://localhost:5173)" || echo "前端未就绪，查看 /tmp/frontend.log"
