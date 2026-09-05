import { canonicalConceptName } from "./conceptIdentity";

type Row = Record<string, unknown>;
export const PROFILE_REPAIR_KEY = "migration.personalization.semantic-profile-v1";
export interface RepairDatabase {
  query(statement: string, values?: unknown[]): Promise<Row[]>;
  run(statement: string, values?: unknown[]): Promise<unknown>;
}
function object(value: unknown): Row {
  try {
    const parsed: unknown = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Row : { originalValue: parsed };
  } catch { return { originalValue: value }; }
}

/** Run inside the caller's transaction; never erase user judgements or answers. */
export async function repairLegacyProfile(database: RepairDatabase): Promise<void> {
  if ((await database.query("SELECT 1 FROM settings WHERE key=?", [PROFILE_REPAIR_KEY])).length) return;
  const stamp = new Date().toISOString();
  for (const row of await database.query(`SELECT * FROM learning_evidence_v2 WHERE source='question'
    AND action IN ('asked_definition','asked_clarification') AND (direction<>'neutral' OR strength<>0)`)) {
    const context = object(row.context_json);
    context.profileRepair = { version: 1, direction: row.direction, strength: row.strength };
    const result = object(row.result_json);
    result.explanation = "曾主动询问这个概念；提问本身不能证明已掌握或不熟悉。";
    await database.run("UPDATE learning_evidence_v2 SET direction='neutral',strength=0,context_json=?,result_json=? WHERE id=?",
      [JSON.stringify(context), JSON.stringify(result), row.id]);
  }
  for (const row of await database.query("SELECT * FROM document_terms WHERE status='candidate'")) {
    if (canonicalConceptName(String(row.canonical_name || row.term_text)) || row.link_origin === "user" || row.qa_record_id != null) continue;
    const span = object(row.source_span_json);
    span.profileRepair = { version: 1, status: row.status };
    await database.run("UPDATE document_terms SET status='dismissed',source_span_json=?,updated_at=? WHERE id=?",
      [JSON.stringify(span), stamp, row.id]);
  }
  for (const old of await database.query("SELECT * FROM concepts WHERE concept_key LIKE 'global:%'")) {
    const clean = canonicalConceptName(String(old.canonical_name));
    if (!clean || clean === old.canonical_name) continue;
    let canonical = (await database.query("SELECT * FROM concepts WHERE concept_key LIKE 'global:%' AND lower(canonical_name)=lower(?) LIMIT 1", [clean]))[0];
    if (!canonical) {
      const id = crypto.randomUUID();
      await database.run(`INSERT OR IGNORE INTO concepts(id,concept_key,canonical_name,display_name,domain,concept_type,aliases_json,difficulty,created_at)
        VALUES(?,?,?,?,'general','theory','[]',0.5,?)`, [id, `global:general:${clean.toLocaleLowerCase()}`, clean, clean, stamp]);
      canonical = (await database.query("SELECT * FROM concepts WHERE concept_key=?", [`global:general:${clean.toLocaleLowerCase()}`]))[0];
    }
    for (const row of await database.query("SELECT * FROM learning_evidence_v2 WHERE concept_id=? AND source='question'", [old.id])) {
      const context = object(row.context_json);
      context.originalConceptId = old.id;
      await database.run("UPDATE learning_evidence_v2 SET concept_id=?,context_json=? WHERE id=?", [canonical.id, JSON.stringify(context), row.id]);
    }
    for (const term of await database.query("SELECT * FROM document_terms WHERE concept_id=? AND status='candidate' AND qa_record_id IS NULL", [old.id])) {
      if (term.link_origin === "user") continue;
      const span = object(term.source_span_json);
      span.originalConceptId = old.id;
      await database.run("UPDATE document_terms SET concept_id=?,source_span_json=? WHERE id=?", [canonical.id, JSON.stringify(span), term.id]);
    }
  }
  // Invalidating this derived cache causes normal profile reads to replay evidence.
  await database.run("UPDATE knowledge_states_v2 SET policy_version='needs-profile-replay'");
  await database.run("INSERT INTO settings(key,value) VALUES (?,'done')", [PROFILE_REPAIR_KEY]);
}
