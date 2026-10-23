import type { TeachingDocument, TeachingPassage, TeachingReference } from "../../personalization/teachingApi";
import type { MobileDatabase } from "./database";
import { ensureRange, canonicalRange, type RangeRow } from './learningRanges';
import { appendTeachingManifest, visibleTeachingBody, parseTeachingManifest, TEACHING_MANIFEST_CONTRACT } from "./teachingManifest";
import type { SavedManifest } from "./knowledgeForest";
import { AndroidTeachingOutcomeService } from "./teachingOutcomeService";

type Row = Record<string, unknown>;
type Host = {
  read: (project: number, type: string, path: string) => Promise<string>;
  /** Authoritative manifest published for exactly this content hash, when available. */
  manifest: (project: number, type: "course" | "qa", path: string) => Promise<SavedManifest | null>;
  evidence: (project: number, data: Row) => Promise<{ evidence: { id: string } }>;
  /** Factual state version bump after evidence or feedback changes. */
  stateChanged: () => Promise<void>;
};

const stamp = () => new Date().toISOString();

async function fingerprint(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class TeachingIndex {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private db: MobileDatabase, private host: Host) {}

  private transaction<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(() => this.db.transaction(work));
    this.writes = next.catch(() => undefined);
    return next;
  }

  private reports() {
    return this.db.query<Row>(`SELECT f.*,p.dimension FROM understanding_feedback f
      JOIN teaching_passages p ON p.id=f.passage_id JOIN learning_evidence_v2 e ON e.id=f.evidence_id
      WHERE f.active=1 AND e.voided=0 AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v
        WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)
      ORDER BY f.created_at,f.id`);
  }

  async remove(project: number, path?: string, options: { inTx?: boolean } = {}) {
    const work = async () => {
      const documents = await this.db.queryInTx<Row>("SELECT id FROM teaching_documents WHERE project_id=?" + (path == null ? "" : " AND source_path=?"), path == null ? [project] : [project, path.replace(/\\/g, "/")]);
      for (const document of documents) {
        const feedback = await this.db.queryInTx<Row>("SELECT * FROM understanding_feedback WHERE document_id=? AND active=1", [document.id]);
        for (const row of feedback) if (row.evidence_id) {
          const target = (await this.db.queryInTx<Row>("SELECT * FROM learning_evidence_v2 WHERE id=?", [row.evidence_id]))[0];
          if (target) await this.host.evidence(project, { idempotencyKey: `deleted-teaching:${row.id}`, conceptId: target.concept_id,
            dimension: target.dimension, source: "manual", action: "void_evidence", direction: "neutral", strength: 0,
            reliability: 1, targetEvidenceId: row.evidence_id });
        }
        await this.db.runInTx("DELETE FROM understanding_feedback WHERE document_id=?", [document.id]);
        await this.db.runInTx("DELETE FROM teaching_passages WHERE document_id=?", [document.id]);
        await this.db.runInTx("DELETE FROM teaching_documents WHERE id=?", [document.id]);
      }
      if (path == null) await this.db.runInTx("DELETE FROM teaching_manifests WHERE project_id=?", [project]);
      else await this.db.runInTx("DELETE FROM teaching_manifests WHERE project_id=? AND source_path=?", [project, path.replace(/\\/g, "/")]);
      for (const table of ['teaching_manifest_overrides','teaching_concept_overrides','teaching_backfills']) {
        if (path == null) await this.db.runInTx(`DELETE FROM ${table} WHERE project_id=?`, [project]);
        else await this.db.runInTx(`DELETE FROM ${table} WHERE project_id=? AND source_path=?`, [project,path.replace(/\\/g, '/')]);
      }
    };
    if (options.inTx) await work(); else await this.transaction(work);
    if (!options.inTx) await this.host.stateChanged();
  }

  /**
   * Indexes passages from the same-response v2 manifest. No model is called and
   * no legacy TERMS array is promoted: without a validated manifest a document
   * stays pending instead of claiming verified teaching coverage.
   */
  async index(project: number, type: string, path: string, content: string, options: { force?: boolean; inTx?: boolean } = {}): Promise<string> {
    path = path.replace(/\\/g, "/");
    const hash = await fingerprint(content);
    const old = (await this.db.query<Row>("SELECT * FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=?", [project, type, path]))[0];
    if (!options.force && old?.content_hash === hash) return String(old.id);
    const id = String(old?.id ?? crypto.randomUUID());
    let persistedId = id;
    const override = (await this.db.query<Row>('SELECT manifest_json FROM teaching_manifest_overrides WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?', [project, type, path, hash]))[0];
    const parsed = override ? { status: 'complete', manifest: JSON.parse(String(override.manifest_json)) as import('./teachingManifest').TeachingManifest } : parseTeachingManifest(content);
    const saved = type === "course" || type === "qa"
      ? await this.host.manifest(project, type as "course" | "qa", path)
      : null;
    const body = visibleTeachingBody(content);
    const approved: unknown[][] = [];
    let indexStatus = "pending";
    if (parsed.status === "invalid") indexStatus = "invalid";
    else if (parsed.status === "complete" && parsed.manifest && saved && saved.contentHash === hash && saved.status === "complete") {
      const manifest = parsed.manifest;
      const concepts = new Map(manifest.concepts.map(concept => [concept.ref, concept]));
      const quoteCount = (quote: string) => body.split(quote).length - 1;
      let rejected = 0;
      for (const item of manifest.coverage) {
        const quote = item.quote.trim();
        // Planned or mentioned targets may intentionally carry no locatable quote.
        if (!quote) continue;
        let conceptId = saved.conceptMap[item.concept_ref];
        const correction = (await this.db.query<Row>('SELECT target_concept_id FROM teaching_concept_overrides WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=? AND quote=? AND source_concept_id=?', [project, type, path, hash, item.quote, conceptId]))[0];
        if (correction) conceptId = String(correction.target_concept_id);
        const aspect = (await ensureRange(this.db, conceptId, item.dimension, item.aspect, correction ? undefined : item.aspect_id, options.inTx)).aspect;
        if (!conceptId || !concepts.has(item.concept_ref) || !aspect || quote.length < 8 || quoteCount(quote) !== 1) { rejected++; continue; }
        approved.push([crypto.randomUUID(), id, conceptId, aspect, item.kind, item.core ? 1 : 0, item.dimension, quote,
          body.slice(0, body.indexOf(quote)).split("\n").length, hash, stamp()]);
      }
      const locatable = manifest.coverage.filter(item => item.quote.trim().length > 0).length;
      if (locatable && rejected) indexStatus = approved.length ? "partial" : "invalid";
      else indexStatus = "complete";
    }
    const work = async () => {
      await this.db.runInTx(`INSERT INTO teaching_documents VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id,source_type,source_path)
        DO UPDATE SET content_hash=excluded.content_hash,index_status=excluded.index_status,updated_at=excluded.updated_at`,
      [id, project, type, path, hash, indexStatus, stamp()]);
      const stored = String((await this.db.queryInTx<Row>("SELECT id FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=?", [project, type, path]))[0].id);
      persistedId = stored;
      if (old && old.content_hash !== hash) {
        // Confirmation belongs to the source version it was made on. A new body
        // must not inherit the old "understood" declaration just because the
        // same quote still exists.
        const stale = await this.db.queryInTx<Row>("SELECT * FROM understanding_feedback WHERE document_id=? AND active=1", [stored]);
        for (const row of stale) {
          if (row.evidence_id) {
            const target = (await this.db.queryInTx<Row>("SELECT * FROM learning_evidence_v2 WHERE id=?", [row.evidence_id]))[0];
            if (target) await this.host.evidence(project, {
              idempotencyKey: `replaced-document:${row.id}`, conceptId: target.concept_id,
              dimension: target.dimension, source: "manual", action: "void_evidence",
              direction: "neutral", strength: 0, reliability: 1, targetEvidenceId: row.evidence_id,
            });
          }
          await this.db.runInTx("UPDATE understanding_feedback SET active=0 WHERE id=?", [row.id]);
        }
      }
      await this.db.runInTx("UPDATE teaching_passages SET active=0 WHERE document_id=?", [stored]);
      for (const values of approved) {
        values[1] = stored;
        await this.db.runInTx(`INSERT INTO teaching_passages VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
          ON CONFLICT(document_id,concept_id,aspect,quote) DO UPDATE SET kind=excluded.kind,core=excluded.core,dimension=excluded.dimension,
          start_line=excluded.start_line,content_hash=excluded.content_hash,active=1,updated_at=excluded.updated_at`, values);
      }
    };
    if (options.inTx) await work(); else await this.transaction(work);
    if (!options.inTx && old && old.content_hash !== hash) await this.host.stateChanged().catch(() => undefined);
    return persistedId;
  }

  async reference(project: number, id: string): Promise<TeachingReference> {
    const row = (await this.db.query<Row>(`SELECT p.*,d.project_id,d.source_type,d.source_path,c.display_name,c.concept_key,
      d.content_hash document_hash FROM teaching_passages p JOIN teaching_documents d ON d.id=p.document_id
      JOIN concepts c ON c.id=p.concept_id WHERE p.id=?`, [id]))[0];
    if (!row || (String(row.concept_key).startsWith("project:") && Number(row.project_id) !== project)) throw new Error("讲解引用不存在");
    const content = await this.host.read(Number(row.project_id), String(row.source_type), String(row.source_path));
    const body = visibleTeachingBody(content);
    const quote = String(row.quote);
    if (body.split(quote).length !== 2) throw new Error("原讲解已修改，无法准确定位；请打开来源文档复查");
    return { id, projectId: Number(row.project_id), sourceType: row.source_type as "course" | "qa", sourcePath: String(row.source_path),
      quote, line: body.slice(0, body.indexOf(quote)).split("\n").length, title: `${row.display_name} · ${row.aspect}`, content };
  }

  /** Replaces already-explained blocks with a link reminder, driven by the v2 manifest. */
  async prepare(project: number, content: string, intent = "") {
    const links: string[] = [];
    const ids = new Set<string>();
    for (const match of content.matchAll(/<!-- codecourse-reuse: (.*?) -->/gs)) {
      try { for (const id of JSON.parse(match[1])) if (typeof id === "string") ids.add(id); } catch { /* ignore invalid metadata */ }
    }
    let working = content.replace(/<!-- codecourse-reuse: .*? -->/gs, "").trim();
    const parsed = parseTeachingManifest(working);
    if (parsed.status === "complete" && parsed.manifest
      && !/重[新讲]|从头|没[有]?懂|不[太]?理解|详细[讲解]|再[讲解释]|re.?explain|from scratch|don.t understand/i.test(intent)) {
      const manifest = parsed.manifest;
      let body = visibleTeachingBody(working);
      let changed = false;
      for (const item of manifest.coverage) {
        const quote = item.quote.trim();
        if (item.kind !== "explained" || quote.length < 8 || body.split(quote).length !== 2) continue;
        const pos = body.indexOf(quote);
        if (body.slice(0, pos).trim() && !body.slice(0, pos).endsWith("\n\n")) continue;
        if (body.slice(pos + quote.length).trim() && !body.slice(pos + quote.length).startsWith("\n\n")) continue;
        const concept = manifest.concepts.find(entry => entry.ref === item.concept_ref);
        if (!concept) continue;
        const row = (await this.db.query<Row>(`SELECT p.*,c.display_name FROM teaching_passages p
          JOIN teaching_documents d ON d.id=p.document_id JOIN concepts c ON c.id=p.concept_id
          WHERE p.active=1 AND p.kind='explained' AND lower(c.canonical_name)=lower(?) AND c.domain=?
          AND p.aspect=? AND p.dimension=?
          AND (d.project_id=? OR c.concept_key NOT LIKE 'project:%') ORDER BY (d.project_id=?) DESC,p.updated_at DESC LIMIT 1`,
        [concept.name, concept.domain, item.aspect, item.dimension, project, project]))[0];
        if (!row) continue;
        const latest = (await this.reports()).reverse().find((report) => report.concept_id === row.concept_id && report.aspect === row.aspect && report.dimension === row.dimension);
        if (latest && ["partial", "needs_help"].includes(String(latest.result))) continue;
        try { await this.reference(project, String(row.id)); } catch { continue; }
        const title = `${row.display_name} · ${row.aspect}`.replace(/[\[\]\\\n]/g, "");
        const reminder = `此前已讲解 [${title}](https://codecourse.local/teaching/${row.id})，可回到原文复习。`;
        body = body.replace(quote, reminder);
        item.quote = reminder;
        item.kind = "planned";
        changed = true;
      }
      if (changed) {
        working = appendTeachingManifest(body, manifest);
      }
    }
    for (const id of ids) {
      try {
        const ref = await this.reference(project, id);
        const url = `https://codecourse.local/teaching/${id}`;
        if (!working.includes(url)) links.push(`- [${ref.title.replace(/[\[\]\\\n]/g, "")}](${url})`);
      } catch { /* Never publish fabricated or stale references. */ }
    }
    return working + (links.length ? "\n\n### 相关旧知识\n" + links.join("\n") : "");
  }

  /** Protocol text only; the full tree snapshot comes from KnowledgeForest. */
  context() {
    return TEACHING_MANIFEST_CONTRACT;
  }

  async document(project: number, type: "course" | "qa", path: string): Promise<TeachingDocument> {
    const id = await this.index(project, type, path, await this.host.read(project, type, path));
    const document = (await this.db.query<Row>("SELECT * FROM teaching_documents WHERE id=?", [id]))[0];
    const passages = await this.db.query<Row>(`SELECT p.*,c.display_name FROM teaching_passages p JOIN concepts c ON c.id=p.concept_id
      WHERE p.document_id=? AND p.active=1 ORDER BY p.start_line`, [id]);
    const feedback = await this.db.query<Row>("SELECT * FROM understanding_feedback WHERE document_id=? AND active=1", [id]);
    const evidence = await this.reports();
    const states = await this.db.query<Row>("SELECT concept_id,state_json FROM knowledge_states_v2 WHERE (scope_type='global' AND scope_id='local-user') OR (scope_type='project' AND scope_id=?)", [String(project)]);
    const latest = new Map(evidence.map((report) => [JSON.stringify([report.concept_id, report.aspect, report.dimension]), String(report.result)]));
    const knowledge = new Map(states.map((state) => [String(state.concept_id), JSON.parse(String(state.state_json))]));
    for (const p of passages) {
      const status = knowledge.get(String(p.concept_id))?.dimensions?.[String(p.dimension)]?.status;
      const report = latest.get(JSON.stringify([p.concept_id, p.aspect, p.dimension]));
      p.understanding = report === "needs_help" ? "needs_help" : status === "confirmed" ? "mastered" : report === "understood" ? "understood" : report === "partial" ? "partial" : "pending";
    }
    const core = passages.filter((p) => p.core && ["brief", "explained", "planned"].includes(String(p.kind)));
    const understood = core.filter((p) => ["understood", "mastered"].includes(String(p.understanding))).length;
    let status: TeachingDocument["status"] = "pending";
    if (core.length && document.index_status === "complete") {
      if (core.every((p) => p.understanding === "mastered")) status = "mastered";
      else if (understood === core.length) status = "understood";
      else if (understood || core.some((p) => ["partial", "needs_help"].includes(String(p.understanding)))) status = "partial";
    }
    return { documentId: id, sourceType: type, sourcePath: path, contentHash: String(document.content_hash), indexStatus: document.index_status as TeachingDocument["indexStatus"],
      schemaVersion: (await this.host.manifest(project, type, path))?.status === 'complete' ? 2 : 1,
      status, documentConfirmed: feedback.some((f) => f.result === "understood"), coreCount: core.length, understoodCount: understood, passages: passages as TeachingPassage[], feedback: feedback as TeachingDocument["feedback"] };
  }

  async feedback(project: number, payload: Row) {
    const result = String(payload.result);
    if (!["understood", "partial", "needs_help", "clear"].includes(result)) throw new Error("无效的理解反馈");
    const state = await this.document(project, payload.sourceType as "course" | "qa", String(payload.sourcePath));
    if (state.contentHash !== payload.contentHash) throw new Error("内容已更新，请重新确认本次讲解范围");
    if (state.indexStatus !== "complete") throw new Error("知识清单未就绪，暂不能确认理解；可先修复索引后重试");
    const approved = new Map(state.passages.filter((p) => ["brief", "explained"].includes(p.kind)).map((p) => [p.id, p]));
    const ids = [...new Set(payload.passageIds as string[])];
    if (ids.some((id) => !approved.has(id))) throw new Error("反馈只能关联本次实际讲解的知识点");
    const key = String(payload.requestKey);
    if (!key) throw new Error("反馈缺少请求标识");
    await this.transaction(async () => {
      if ((await this.db.queryInTx("SELECT 1 FROM understanding_feedback WHERE request_key=?", [key])).length) return;
      const current = (await this.db.queryInTx<Row>("SELECT content_hash FROM teaching_documents WHERE id=?", [state.documentId]))[0];
      if (current?.content_hash !== payload.contentHash) throw new Error("内容已更新，请重新确认本次讲解范围");
      const old = await this.db.queryInTx<Row>("SELECT * FROM understanding_feedback WHERE document_id=? AND active=1", [state.documentId]);
      for (const row of old) {
        if (result !== "clear" && row.passage_id && !ids.includes(String(row.passage_id))) continue;
        if (row.evidence_id) {
          const target = (await this.db.queryInTx<Row>("SELECT * FROM learning_evidence_v2 WHERE id=?", [row.evidence_id]))[0];
          if (target) await this.host.evidence(project, { idempotencyKey: `${key}:void:${row.id}`, conceptId: target.concept_id,
            dimension: target.dimension, source: "manual", action: "void_evidence", direction: "neutral", strength: 0,
            reliability: 1, targetEvidenceId: row.evidence_id });
        }
        await this.db.runInTx("UPDATE understanding_feedback SET active=0 WHERE id=?", [row.id]);
      }
      for (const passage of ids.length ? ids.map((id) => approved.get(id)!) : [null]) {
        const id = crypto.randomUUID();
        let evidenceId = null;
        if (passage && result !== "clear") {
          const response = await this.host.evidence(project, { idempotencyKey: id, conceptId: passage.concept_id,
            dimension: passage.dimension, source: "summary", action: `self_${result}`,
            direction: result === "understood" ? "positive" : result === "needs_help" ? "negative" : "neutral",
            strength: result === "partial" ? 0 : .65, reliability: .72,
            object: { type: payload.sourceType, sourcePath: payload.sourcePath }, result: { feedbackId: id, aspect: passage.aspect } });
          evidenceId = response.evidence.id;
        }
        await this.db.runInTx("INSERT INTO understanding_feedback VALUES (?,?,?,?,?,?,?,?,?,?)", [id, key, state.documentId,
          passage?.id ?? null, passage?.concept_id ?? null, passage?.aspect ?? "", result, evidenceId, result === "clear" ? 0 : 1, stamp()]);
      }
      const qa = (await this.db.queryInTx<Row>("SELECT id FROM qa_records WHERE project_id=? AND output_path=?", [project, payload.sourcePath]))[0];
      const trial = qa ? (await this.db.queryInTx<Row>("SELECT id FROM teaching_trials WHERE project_id=? AND qa_record_id=? ORDER BY created_at DESC LIMIT 1", [project, qa.id]))[0] : null;
      if (trial) {
        const ref = `understanding:${state.documentId}`;
        await this.db.runInTx("DELETE FROM teaching_outcomes WHERE teaching_trial_id=? AND evidence_ref_id=?", [trial.id, ref]);
        if (result !== "clear") await new AndroidTeachingOutcomeService(this.db).recordOutcome({
          idempotencyKey: key + ":outcome", projectId: project, teachingTrialId: String(trial.id),
          result: result === "understood" ? "successful" : result === "partial" ? "partially_successful" : "unsuccessful",
          confidence: 1, reason: "用户明确反馈本次讲解的理解情况", evidenceQuote: result, evidenceType: "manual_feedback", evidenceRefId: ref,
        }, true);
        const strongest = (await this.db.queryInTx<Row>("SELECT result FROM teaching_outcomes WHERE teaching_trial_id=? ORDER BY authority DESC,created_at DESC LIMIT 1", [trial.id]))[0];
        await this.db.runInTx("UPDATE teaching_trials SET previous_outcome=? WHERE id=?", [strongest?.result ?? null, trial.id]);
      }
    });
    await this.host.stateChanged();
    return this.document(project, payload.sourceType as "course" | "qa", String(payload.sourcePath));
  }
}
