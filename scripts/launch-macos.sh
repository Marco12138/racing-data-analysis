#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$project_root/storage/runtime"
log_dir="$runtime_dir/logs"
frontend_url="http://localhost:3000/"
backend_url="http://127.0.0.1:8000/api/v1/health"

mkdir -p "$log_dir"

bundled_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
export PATH="$bundled_root/node/bin:$bundled_root/bin/fallback:/opt/anaconda3/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

find_python() {
  local candidate
  for candidate in "${PYTHON_COMMAND:-}" python python3 /opt/anaconda3/bin/python; do
    [[ -n "$candidate" ]] || continue
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c "import fastapi, uvicorn, cv2" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

python_command="$(find_python || true)"
pnpm_command="${PNPM_COMMAND:-$(command -v pnpm || true)}"

if [[ -z "$python_command" ]]; then
  echo "未找到包含 FastAPI、Uvicorn 和 OpenCV 的 Python 环境。"
  echo "请在终端运行：python -m pip install -r \"$project_root/requirements.txt\""
  read -r -p "按回车键关闭..."
  exit 1
fi

if [[ -z "$pnpm_command" ]]; then
  echo "未找到 pnpm/Node 运行环境。"
  read -r -p "按回车键关闭..."
  exit 1
fi

is_healthy() {
  curl --silent --fail --max-time 2 "$backend_url" >/dev/null 2>&1 &&
    curl --silent --fail --max-time 2 "$frontend_url" >/dev/null 2>&1
}

open_site() {
  open "http://localhost:3000/"
  echo "网站已启动：http://localhost:3000/"
}

if is_healthy; then
  open_site
  exit 0
fi

cd "$project_root"

if ! curl --silent --fail --max-time 2 "$backend_url" >/dev/null 2>&1; then
  "$python_command" "$project_root/scripts/detach_process.py" \
    "$log_dir/backend.log" "$project_root" \
    "$python_command" -m uvicorn backend.app.main:app \
    --host 127.0.0.1 --port 8000 >"$runtime_dir/backend.pid"
fi

if ! curl --silent --fail --max-time 2 "$frontend_url" >/dev/null 2>&1; then
  "$python_command" "$project_root/scripts/detach_process.py" \
    "$log_dir/frontend.log" "$project_root" \
    "$pnpm_command" run dev:next --hostname 127.0.0.1 --port 3000 \
    >"$runtime_dir/frontend.pid"
fi

echo "正在启动赛车分析网站..."
for _ in $(seq 1 60); do
  if is_healthy; then
    open_site
    exit 0
  fi
  sleep 1
done

echo
echo "启动超时。日志位置："
echo "  $log_dir/backend.log"
echo "  $log_dir/frontend.log"
open "$log_dir" >/dev/null 2>&1 || true
read -r -p "按回车键关闭..."
exit 1
