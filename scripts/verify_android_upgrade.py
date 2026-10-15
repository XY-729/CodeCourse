"""Check APK upgrade identity against an actual previously installed build."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


def inspect_apk(apk: Path, build_tools: Path) -> tuple[str, int, set[str]]:
    signer = build_tools / ("apksigner.bat" if sys.platform == "win32" else "apksigner")
    aapt = build_tools / ("aapt.exe" if sys.platform == "win32" else "aapt")
    certificate = subprocess.run(
        [str(signer), "verify", "--print-certs", str(apk)],
        check=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stdout
    fingerprints = set(re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$", certificate, re.M))
    badging = subprocess.run(
        [str(aapt), "dump", "badging", str(apk)],
        check=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stdout
    package = re.search(r"^package: name='([^']+)' versionCode='(\d+)'", badging, re.M)
    if not fingerprints or package is None:
        raise ValueError(f"Cannot read APK identity: {apk.name}")
    return package[1], int(package[2]), {value.lower() for value in fingerprints}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("previous", type=Path)
    parser.add_argument("updated", type=Path)
    parser.add_argument("--build-tools", type=Path, required=True)
    args = parser.parse_args()
    old = inspect_apk(args.previous, args.build_tools)
    new = inspect_apk(args.updated, args.build_tools)
    if old[0] != new[0]:
        raise ValueError("Application IDs differ; this APK cannot update the previous app")
    if old[2] != new[2]:
        raise ValueError("Signing certificates differ; do not uninstall the previous app")
    if new[1] < old[1]:
        raise ValueError("Version code decreased; this APK is a downgrade")
    print(f"Upgrade identity verified: {old[0]}, versionCode {old[1]} -> {new[1]}")
    print(f"Matching signer SHA-256: {', '.join(sorted(new[2]))}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"Upgrade verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
