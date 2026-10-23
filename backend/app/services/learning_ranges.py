"""Stable per-concept teaching ranges, with explicit, reversible synonyms."""
import copy
import hashlib
import unicodedata


def key(text):
    return " ".join(unicodedata.normalize("NFKC", str(text)).strip().lower().split())


def aspect_id(concept_id, dimension, aspect):
    return "r_" + hashlib.sha256(f"{concept_id}\0{dimension}\0{key(aspect)}".encode()).hexdigest()[:16]


def catalog(conn, concept_id):
    result = {}
    for row in conn.execute("SELECT * FROM learning_range_aliases WHERE concept_id=? ORDER BY dimension,alias", (concept_id,)):
        item = result.setdefault(row["aspect_id"], {"aspect_id": row["aspect_id"], "aspect": row["canonical"],
            "dimension": row["dimension"], "aliases": []})
        if row["alias"] != key(row["canonical"]):
            item["aliases"].append(row["alias"])
    return list(result.values())


def resolve(conn, concept_id, dimension, aspect, provided_id=None):
    aspect = str(aspect).strip()
    rows = conn.execute("SELECT * FROM learning_range_aliases WHERE concept_id=? AND dimension=?", (concept_id, dimension)).fetchall()
    matched = next((row for row in rows if row["aspect_id"] == provided_id), None) if provided_id else next((row for row in rows if row["alias"] == key(aspect)), None)
    if provided_id and matched is None:
        former = conn.execute('SELECT a.canonical FROM learning_range_aliases a JOIN concept_redirects r ON r.source_id=a.concept_id WHERE a.aspect_id=? AND a.dimension=? AND r.target_id=?',
            (provided_id, dimension, concept_id)).fetchone()
        if former: return resolve(conn, concept_id, dimension, former[0])
        raise ValueError("范围编号不属于该概念与维度，请刷新后重试")
    canonical, identity = (matched["canonical"], matched["aspect_id"]) if matched else (aspect, aspect_id(concept_id, dimension, aspect))
    conn.execute("INSERT OR IGNORE INTO learning_range_aliases VALUES(?,?,?,?,?)", (concept_id, dimension, key(canonical), canonical, identity))
    previous = next((row for row in rows if row["alias"] == key(aspect)), None)
    if previous and previous["aspect_id"] != identity:
        raise ValueError("范围同义关联冲突，请在知识树中明确合并")
    conn.execute("INSERT OR IGNORE INTO learning_range_aliases VALUES(?,?,?,?,?)", (concept_id, dimension, key(aspect), canonical, identity))
    return canonical, identity


def normalize_evidence(conn, evidence):
    """Replay canonical ranges while preserving the original evidence bytes."""
    result = copy.deepcopy(evidence)
    for event in result:
        payload = event.get("result") or {}
        dimension = event["dimension"]
        if payload.get("aspect"):
            payload["aspect"], _ = resolve(conn, event["conceptId"], dimension, payload["aspect"])
        for field in ("ranges", "range"):
            ranges = payload.get(field)
            for entry in ranges if isinstance(ranges, list) else [ranges] if isinstance(ranges, dict) else []:
                if entry.get("aspect"):
                    entry["aspect"], _ = resolve(conn, event["conceptId"], entry.get("dimension", dimension), entry["aspect"])
    return result


def normalize_proposal(value, snapshot):
    """Resolve IDs against the frozen model context, before ownership checks."""
    result = copy.deepcopy(value)
    nodes = {node["id"]: node for node in snapshot["nodes"]}
    refs = {item["ref"]: item.get("existing_id") for item in result.get("concepts", [])}
    def visit(item):
        if isinstance(item, list):
            for child in item: visit(child)
        elif isinstance(item, dict):
            if item.get("aspect_id"):
                identity = item.get("existing_id") or refs.get(item.get("concept_ref"))
                node = nodes.get(identity, {})
                ranges = node.get("range_catalog", []) + node.get("ranges", []) + node.get("coverage", [])
                matched = next((r for r in ranges if r.get("aspect_id") == item["aspect_id"] and r.get("dimension") == item.get("dimension")), None)
                if matched is None:
                    raise ValueError("范围编号不属于冻结知识树中的该概念与维度")
                item["aspect"] = matched["aspect"]
            for child in item.values(): visit(child)
    visit(result)
    return result
