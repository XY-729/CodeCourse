from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


FORBIDDEN_TEXT = (
    b"XY-729",
    b"CPPJUDGE",
    b"C:\\Users\\xiyua",
    b"/home/xiyuan729",
    b"DEEPSEEK_API_KEY=",
)
FORBIDDEN_NAMES = (
    re.compile(r"(^|/)app\.db$", re.IGNORECASE),
    re.compile(r"(^|/)workspace/(repos|generated)/", re.IGNORECASE),
    re.compile(r"(^|/)\.env$", re.IGNORECASE),
    re.compile(r"(^|/).+\.(jks|keystore)$", re.IGNORECASE),
)


def scan(apk: Path) -> list[str]:
    findings: list[str] = []
    with zipfile.ZipFile(apk) as archive:
        for member in archive.infolist():
            normalized = member.filename.replace("\\", "/")
            if any(pattern.search(normalized) for pattern in FORBIDDEN_NAMES):
                findings.append(f"forbidden embedded path: {normalized}")
                continue
            if member.file_size > 24 * 1024 * 1024:
                continue
            payload = archive.read(member)
            for marker in FORBIDDEN_TEXT:
                if marker.lower() in payload.lower():
                    findings.append(
                        f"private marker {marker.decode('utf-8', errors='replace')!r} in {normalized}"
                    )
    return findings


def main() -> int:
    paths = [Path(value) for value in sys.argv[1:]]
    if not paths:
        print("usage: scan_mobile_artifact.py APK [APK ...]", file=sys.stderr)
        return 2
    failures: list[str] = []
    for path in paths:
        if not path.is_file():
            failures.append(f"missing APK: {path}")
            continue
        failures.extend(f"{path}: {finding}" for finding in scan(path))
    if failures:
        print("Mobile privacy scan failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Mobile privacy scan passed for {len(paths)} APK(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
