#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")" && pwd)"
"$project_root/scripts/stop-local.sh"
sleep 2
