import { coverageBody, coverageItems, TEACHING_CONTRACT } from "../../personalization/teachingMetadata";
import type { TeachingDocument, TeachingPassage, TeachingReference } from "../../personalization/teachingApi";
import type { MobileDatabase } from "./database";
import { AndroidTeachingOutcomeService } from "./teachingOutcomeService";

type Row = Record<string, unknown>;
type Host = {
  read: (project: number, type: string, path: string) => Promise<string>;
  resolve: (project: number, concept: string, scope: string) => Promise<string>;
  evidence: (project: number, data: Row) => Promise<{ evidence: { id: string } }>;
};
const stamp = () => new Date().toISOString();
async function fingerprint(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
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

  async remove(project: number, path?: string) {
    await this.transaction(async () => {
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
    });
  }

  async index(project: number, type: string, path: string, content: string): Promise<string> {
    path = path.replace(/\\/g, "/");
    const hash = await fingerprint(content);
    const old = (await this.db.query<Row>("SELECT * FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=?", [project, type, path]))[0];
    if (old?.content_hash === hash) return String(old.id);
    let id = String(old?.id ?? crypto.randomUUID());
    const parsed = coverageItems(content);
    const body = coverageBody(content);
    const approved: unknown[][] = [];
    let rejected = 0;
    for (const item of parsed.items) {
      const concept = String(item?.concept ?? "").trim();
      const aspect = String(item?.aspect ?? "").trim().slice(0, 200);
      const quote = String(item?.quote ?? "").trim();
      let kind = String(item?.kind ?? "mentioned");
      if (!concept || !aspect || quote.length < 8 || body.split(quote).length !== 2 || !["mentioned", "brief", "explained", "planned"].includes(kind)) { rejected++; continue; }
      let conceptId: string;
      try { conceptId = await this.host.resolve(project, concept, String(item.scope ?? "global")); }
      catch { rejected++; continue; }
      if (path.toLowerCase().includes("outline") || content.includes("CODECOURSE_OUTLINE")) kind = "planned";
      const dimension = ["conceptual", "code_reading", "implementation", "debugging", "transfer"].includes(String(item.dimension)) ? item.dimension : "conceptual";
      approved.push([crypto.randomUUID(), id, conceptId, aspect, kind, item.core === true ? 1 : 0, dimension, quote,
        body.slice(0, body.indexOf(quote)).split("\n").length, hash, stamp()]);
    }
    await this.transaction(async () => {
      await this.db.runInTx(`INSERT INTO teaching_documents VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id,source_type,source_path)
        DO UPDATE SET content_hash=excluded.content_hash,index_status=excluded.index_status,updated_at=excluded.updated_at`,
      [id, project, type, path, hash, parsed.valid && !rejected ? "complete" : approved.length ? "partial" : "pending", stamp()]);
      id = String((await this.db.queryInTx<Row>("SELECT id FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=?", [project, type, path]))[0].id);
      await this.db.runInTx("UPDATE teaching_passages SET active=0 WHERE document_id=?", [id]);
      for (const values of approved) { values[1] = id; await this.db.runInTx(`INSERT INTO teaching_passages VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
        ON CONFLICT(document_id,concept_id,aspect,quote) DO UPDATE SET kind=excluded.kind,core=excluded.core,dimension=excluded.dimension,
        start_line=excluded.start_line,content_hash=excluded.content_hash,active=1,updated_at=excluded.updated_at`, values); }
    });
    return id;
  }

  async reference(project: number, id: string): Promise<TeachingReference> {
    const row = (await this.db.query<Row>(`SELECT p.*,d.project_id,d.source_type,d.source_path,c.display_name,c.concept_key
      FROM teaching_passages p JOIN teaching_documents d ON d.id=p.document_id JOIN concepts c ON c.id=p.concept_id WHERE p.id=?`, [id]))[0];
    if (!row || (String(row.concept_key).startsWith("project:") && Number(row.project_id) !== project)) throw new Error("讲解引用不存在");
    const content = await this.host.read(Number(row.project_id), String(row.source_type), String(row.source_path));
    const body = coverageBody(content);
    const quote = String(row.quote);
    if (body.split(quote).length !== 2) throw new Error("原讲解已修改，无法准确定位；请打开来源文档复查");
    return { id, projectId: Number(row.project_id), sourceType: row.source_type as "course" | "qa", sourcePath: String(row.source_path),
      quote, line: body.slice(0, body.indexOf(quote)).split("\n").length, title: `${row.display_name} · ${row.aspect}`, content };
  }

  async prepare(project: number, content: string, intent = "") {
    const links: string[] = [];
    const ids = new Set<string>();
    for (const match of content.matchAll(/<!-- codecourse-reuse: (.*?) -->/gs)) {
      try { for (const id of JSON.parse(match[1])) if (typeof id === "string") ids.add(id); } catch { /* ignore invalid metadata */ }
    }
    content = content.replace(/<!-- codecourse-reuse: .*? -->/gs, "").trim();
    if (!/重[新讲]|从头|没[有]?懂|不[太]?理解|详细[讲解]|再[讲解释]|re.?explain|from scratch|don.t understand/i.test(intent)) {
      const parsed = coverageItems(content);
      let body = content.replace(/<!-- codecourse-teaching: .*? -->/gs, "").trim();
      let changed = false;
      for (const item of parsed.items) {
        const quote = String(item?.quote ?? "").trim();
        if (item?.kind !== "explained" || quote.length < 8 || body.split(quote).length !== 2) continue;
        const pos = body.indexOf(quote);
        if (body.slice(0, pos).trim() && !body.slice(0, pos).endsWith("\n\n")) continue;
        if (body.slice(pos + quote.length).trim() && !body.slice(pos + quote.length).startsWith("\n\n")) continue;
        const row = (await this.db.query<Row>(`SELECT p.*,c.display_name FROM teaching_passages p
          JOIN teaching_documents d ON d.id=p.document_id JOIN concepts c ON c.id=p.concept_id
          WHERE p.active=1 AND p.kind='explained' AND lower(c.canonical_name)=lower(?) AND p.aspect=? AND p.dimension=?
          AND (d.project_id=? OR c.concept_key NOT LIKE 'project:%') ORDER BY (d.project_id=?) DESC,p.updated_at DESC LIMIT 1`,
        [String(item.concept), String(item.aspect), String(item.dimension ?? "conceptual"), project, project]))[0];
        if (!row) continue;
        const latest = (await this.reports()).reverse().find((r) => r.concept_id === row.concept_id && r.aspect === row.aspect && r.dimension === row.dimension);
        if (latest && ["partial", "needs_help"].includes(String(latest.result))) continue;
        try { await this.reference(project, String(row.id)); } catch { continue; }
        const title = `${row.display_name} · ${row.aspect}`.replace(/[\[\]\\\n]/g, "");
        const reminder = `此前已讲解 [${title}](https://codecourse.local/teaching/${row.id})，可回到原文复习。`;
        body = body.replace(quote, reminder); item.quote = reminder; item.kind = "planned"; changed = true;
      }
      if (changed) content = body + `\n\n<!-- codecourse-teaching: ${JSON.stringify(parsed.items).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")} -->`;
    }
    for (const id of ids) {
      try {
        const ref = await this.reference(project, id);
        const url = `https://codecourse.local/teaching/${id}`;
        if (!content.includes(url)) links.push(`- [${ref.title.replace(/[\[\]\\\n]/g, "")}](${url})`);
      } catch { /* Never publish fabricated or stale references. */ }
    }
    return content + (links.length ? "\n\n### 相关旧知识\n" + links.join("\n") : "");
  }

  async context(project: number, query = "") {
    const rows = await this.db.query<Row>(`SELECT p.*,d.project_id,c.display_name FROM teaching_passages p
      JOIN teaching_documents d ON d.id=p.document_id JOIN concepts c ON c.id=p.concept_id JOIN projects pr ON pr.id=d.project_id
      WHERE p.active=1 AND p.kind IN ('brief','explained') AND (d.project_id=? OR c.concept_key NOT LIKE 'project:%')
      ORDER BY p.updated_at DESC LIMIT 160`, [project]);
    const folded = query.toLowerCase();
    const score = (r: Row) => (folded && folded.includes(String(r.display_name).toLowerCase()) ? 2 : 0) + (Number(r.project_id) === project ? 1 : 0);
    rows.sort((a, b) => score(b) - score(a));
    const entries: Row[] = [];
    const reports = new Map((await this.reports()).map((r) => [JSON.stringify([r.concept_id, r.aspect, r.dimension]), r.result]));
    for (const row of rows) {
      try { await this.reference(project, String(row.id)); } catch { continue; }
      entries.push({ id: row.id, concept: row.display_name, aspect: row.aspect, kind: row.kind,
        self_report: reports.get(JSON.stringify([row.concept_id, row.aspect, row.dimension])) ?? "unknown",
        excerpt: String(row.quote).slice(0, 450), url: `https://codecourse.local/teaching/${row.id}` });
      if (entries.length === 40) break;
    }
    return TEACHING_CONTRACT + `\n<prior_teaching>\n${JSON.stringify(entries).replace(/</g, "\\u003c")}\n</prior_teaching>`;
  }

  async document(project: number, type: "course" | "qa", path: string): Promise<TeachingDocument> {
    const id = await this.index(project, type, path, await this.host.read(project, type, path));
    const document = (await this.db.query<Row>("SELECT * FROM teaching_documents WHERE id=?", [id]))[0];
    const passages = await this.db.query<Row>(`SELECT p.*,c.display_name FROM teaching_passages p JOIN concepts c ON c.id=p.concept_id
      WHERE p.document_id=? AND p.active=1 ORDER BY p.start_line`, [id]);
    const feedback = await this.db.query<Row>("SELECT * FROM understanding_feedback WHERE document_id=? AND active=1", [id]);
    const evidence = await this.reports();
    const states = await this.db.query<Row>("SELECT concept_id,state_json FROM knowledge_states_v2 WHERE (scope_type='global' AND scope_id='local-user') OR (scope_type='project' AND scope_id=?)", [String(project)]);
    const latest = new Map(evidence.map((f) => [JSON.stringify([f.concept_id, f.aspect, f.dimension]), String(f.result)]));
    const knowledge = new Map(states.map((s) => [String(s.concept_id), JSON.parse(String(s.state_json))]));
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
      status, documentConfirmed: feedback.some((f) => f.result === "understood"), coreCount: core.length, understoodCount: understood, passages: passages as TeachingPassage[], feedback: feedback as TeachingDocument["feedback"] };
  }

  async feedback(project: number, payload: Row) {
    const result = String(payload.result);
    if (!["understood", "partial", "needs_help", "clear"].includes(result)) throw new Error("无效的理解反馈");
    const state = await this.document(project, payload.sourceType as "course" | "qa", String(payload.sourcePath));
    if (state.contentHash !== payload.contentHash) throw new Error("内容已更新，请重新确认本次讲解范围");
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
    return this.document(project, payload.sourceType as "course" | "qa", String(payload.sourcePath));
  }
}
