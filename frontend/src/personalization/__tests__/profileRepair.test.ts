// @vitest-environment node
// @ts-expect-error Bundled Node 24 supports SQLite; the frontend's older Node typings do not.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { repairLegacyProfile } from "../profileRepair";
type SQLInputValue = string | number | bigint | null | Uint8Array;

describe("mobile legacy profile repair with real SQLite", () => {
  it("preserves manual facts, normalizes automatic terms, and runs once", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE concepts(id TEXT PRIMARY KEY,concept_key TEXT UNIQUE,canonical_name TEXT,display_name TEXT,domain TEXT,concept_type TEXT,aliases_json TEXT,difficulty REAL,created_at TEXT);
        CREATE TABLE learning_evidence_v2(id TEXT,concept_id TEXT,source TEXT,action TEXT,direction TEXT,strength REAL,context_json TEXT,result_json TEXT);
        CREATE TABLE document_terms(id INTEGER,concept_id TEXT,term_text TEXT,canonical_name TEXT,status TEXT,qa_record_id INTEGER,link_origin TEXT,source_span_json TEXT,updated_at TEXT);
        CREATE TABLE knowledge_states_v2(policy_version TEXT);
        INSERT INTO concepts VALUES('old','global:general:std::vector<int>','std::vector<int>','std::vector<int>','general','theory','[]',0.5,'before');
        INSERT INTO learning_evidence_v2 VALUES('q','old','question','asked_definition','negative',0.7,'{}','{}');
        INSERT INTO learning_evidence_v2 VALUES('m','old','manual','manual_known','positive',1,'{}','{}');
        INSERT INTO document_terms VALUES(1,'old','std::vector<int>',NULL,'candidate',NULL,'automatic','{}','before');
        INSERT INTO document_terms VALUES(2,NULL,'下一步学习建议',NULL,'candidate',NULL,'automatic','{}','before');
        INSERT INTO document_terms VALUES(3,NULL,'下一步学习建议',NULL,'linked',8,'user','{}','before');`);
      const adapter = {
        query: async (sql: string, values: unknown[] = []) => sqlite.prepare(sql).all(...values as SQLInputValue[]),
        run: async (sql: string, values: unknown[] = []) => sqlite.prepare(sql).run(...values as SQLInputValue[]),
      };
      await repairLegacyProfile(adapter);
      const question = sqlite.prepare("SELECT * FROM learning_evidence_v2 WHERE id='q'").get()!;
      expect(question.direction).toBe("neutral");
      expect(question.strength).toBe(0);
      expect(question.concept_id).not.toBe("old");
      expect(JSON.parse(String(question.context_json)).profileRepair.direction).toBe("negative");
      expect(sqlite.prepare("SELECT concept_id FROM learning_evidence_v2 WHERE id='m'").get()?.concept_id).toBe("old");
      expect(sqlite.prepare("SELECT status FROM document_terms WHERE id=2").get()?.status).toBe("dismissed");
      expect(sqlite.prepare("SELECT status FROM document_terms WHERE id=3").get()?.status).toBe("linked");
      sqlite.exec("UPDATE learning_evidence_v2 SET direction='negative' WHERE id='q'");
      await repairLegacyProfile(adapter);
      expect(sqlite.prepare("SELECT direction FROM learning_evidence_v2 WHERE id='q'").get()?.direction).toBe("negative");
    } finally { sqlite.close(); }
  });
});
