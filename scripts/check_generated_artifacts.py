from __future__ import annotations

import subprocess
import sys

BLOCKED_MARKERS = (
    ".egg-info/",
    "__pycache__/",
    ".pytest_cache/",
    ".ruff_cache/",
    ".mypy_cache/",
)


def main() -> int:
    tracked = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
    offenders = [
        path
        for path in tracked
        if path.endswith(".log") or any(marker in path.replace("\\", "/") for marker in BLOCKED_MARKERS)
    ]
    if offenders:
        print("Generated artifacts are tracked and must be removed:")
        for path in offenders:
            print(f"- {path}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
