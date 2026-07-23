"""Start a command in a detached process group and print its process ID."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    """Launch the requested command independently from the caller terminal."""
    if len(sys.argv) < 4:
        raise SystemExit("usage: detach_process.py LOG_FILE WORKING_DIR COMMAND...")

    log_path = Path(sys.argv[1])
    working_dir = Path(sys.argv[2])
    command = sys.argv[3:]
    log_path.parent.mkdir(parents=True, exist_ok=True)

    with log_path.open("ab") as log_file:
        process = subprocess.Popen(
            command,
            cwd=working_dir,
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    print(process.pid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
