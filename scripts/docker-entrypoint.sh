#!/bin/sh
set -eu

# Railway volumes are mounted after image build and may initially be root-owned.
# Prepare only the application-owned directories, then run the API unprivileged.
for directory in /app/storage /data; do
  mkdir -p "$directory"
  chown appuser:appuser "$directory"
done

exec gosu appuser "$@"
