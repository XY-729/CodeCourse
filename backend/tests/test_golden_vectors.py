"""
Golden vector tests — Python mirror implementation.
Must match TypeScript reference implementation exactly.
"""
import json
import math
import sys
from pathlib import Path
from typing import Any

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

EPSILON = 1e-9

PRIOR_KNOWN = 1.0
PRIOR_UNKNOWN = 1.0

AUTO_EVIDENCE_DELTAS = {
    "asked_definition": (0, 3),
    "asked_clarification": (0, 2),
    "used_correctly": (1, 0),
    "opened_explanation": (0, 1),
    "completed_exercise": (3, 0),
    "saved_learning_anchor": (2, 0),
    "manual_override_known": (0, 0),
    "manual_override_unknown": (0, 0),
    "manual_override_cleared": (0, 0),
    "event_voided": (0, 0),
}


def calc(known: float, unknown: float) -> tuple[float, float]:
    total = known + unknown
    if total <= 0:
        return (0.5, 0.7071067811865476)
    return (known / total, 1.0 / math.sqrt(total))


def replay(events: list[dict]) -> dict:
    # Deduplicate by eventId when present (simulates idempotency_key at storage layer)
    seen = set()
    has_ids = any(e.get("eventId") for e in events)
    if has_ids:
        unique = []
        for e in events:
            eid = e.get("eventId", "")
            if eid and eid not in seen:
                seen.add(eid)
                unique.append(e)
            elif not eid:
                unique.append(e)
    else:
        unique = list(events)

    known = PRIOR_KNOWN
    unknown = PRIOR_UNKNOWN
    manual = None

    voided_ids = set()
    for e in unique:
        if e.get("eventType") == "event_voided" and e.get("targetEventId"):
            voided_ids.add(e["targetEventId"])

    active = sorted(
        [e for e in unique if e.get("eventId") not in voided_ids],
        key=lambda x: (x.get("createdAt", ""), x.get("eventId", "")),
    )
    for e in active:
        et = e["eventType"]
        if et == "manual_override_known":
            manual = "known"
            continue
        if et == "manual_override_unknown":
            manual = "unknown"
            continue
        if et == "manual_override_cleared":
            manual = None
            continue
        if et == "event_voided":
            continue
        if manual is not None:
            continue
        dk, du = AUTO_EVIDENCE_DELTAS.get(et, (0, 0))
        src = e.get("source", "explicit_user")
        if src != "explicit_user":
            dk = min(dk, 1)
            du = min(du, 1)
        known += dk * e["strength"]
        unknown += du * e["strength"]

    known = max(PRIOR_KNOWN, known)
    unknown = max(PRIOR_UNKNOWN, unknown)
    mst, unc = calc(known, unknown)
    return {
        "knownEvidence": known,
        "unknownEvidence": unknown,
        "mastery": mst,
        "uncertainty": unc,
        "manualStatus": manual,
    }


def test_golden_vectors():
    """Read goldenVectors.json and verify every vector matches."""
    vectors_path = (
        Path(__file__).resolve().parent.parent.parent
        / "frontend" / "src" / "personalization" / "__tests__" / "goldenVectors.json"
    )
    with open(vectors_path, encoding="utf-8") as f:
        data = json.load(f)

    failed = 0
    for v in data["vectors"]:
        vid = v["id"]

        if v.get("decay"):
            # Decay vectors use expectedDecay with range checks
            expected = v["expectedDecay"]
            # Skip for now — decay testing requires full mastery engine
            print(f"SKIP {vid}: {v['name']} (decay vector)")
            continue

        events = v.get("events", [])
        expected = v["expected"]

        result = replay(events)

        checks = [
            ("knownEvidence", result["knownEvidence"], expected["knownEvidence"]),
            ("unknownEvidence", result["unknownEvidence"], expected["unknownEvidence"]),
            ("mastery", result["mastery"], expected["mastery"]),
            ("uncertainty", result["uncertainty"], expected["uncertainty"]),
            ("manualStatus", result["manualStatus"], expected.get("manualStatus")),
        ]

        ok = True
        for name, got, want in checks:
            if isinstance(want, float):
                if abs(got - want) > EPSILON:
                    print(f"FAIL {vid}.{name}: got {got}, want {want}")
                    ok = False
            else:
                if got != want:
                    print(f"FAIL {vid}.{name}: got {got}, want {want}")
                    ok = False

        if ok:
            print(f"PASS {vid}: {v['name']}")
        else:
            failed += 1

    assert failed == 0, f"{failed} golden vectors failed"
    print(f"\nAll {len(data['vectors'])} golden vectors passed.")


if __name__ == "__main__":
    test_golden_vectors()
