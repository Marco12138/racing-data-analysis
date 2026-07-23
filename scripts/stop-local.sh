#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$project_root/storage/runtime"
stopped=0

for service in frontend backend; do
  pid_file="$runtime_dir/$service.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(tr -dc '0-9' <"$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      stopped=1
    fi
    rm -f "$pid_file"
  fi
done

if [[ "$stopped" -eq 1 ]]; then
  echo "赛车分析网站已关闭。"
else
  echo "网站当前没有运行。"
fi
