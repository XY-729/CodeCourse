import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { CodeCourseSecureStore } from "../runtime";

const DATABASE = "codecourse_mobile";
const DATABASE_VERSION = 1;

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class MobileDatabase {
  private opened = false;
  private ftsVersion: 4 | 5 = 4;

  async init(): Promise<void> {
    if (this.opened) return;
    let secret = (await CodeCourseSecureStore.get({ key: "database_secret" })).value;
    if (!secret) {
      secret = randomSecret();
      await CodeCourseSecureStore.set({ key: "database_secret", value: secret });
    }
    const stored = await CapacitorSQLite.isSecretStored();
    if (!stored.result) await CapacitorSQLite.setEncryptionSecret({ passphrase: secret });
    await CapacitorSQLite.createConnection({
      database: DATABASE,
      version: DATABASE_VERSION,
      encrypted: true,
      mode: "secret",
      readonly: false,
    });
    await CapacitorSQLite.open({ database: DATABASE, readonly: false });
    await this.createSchema();
    this.opened = true;
  }

  private async createSchema(): Promise<void> {
    await CapacitorSQLite.execute({
      database: DATABASE,
      statements: `
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          project_type TEXT NOT NULL DEFAULT 'repository',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          language TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          is_key_file INTEGER NOT NULL DEFAULT 0,
          UNIQUE(project_id, path) ON CONFLICT REPLACE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS course_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          title TEXT NOT NULL,
          group_name TEXT NOT NULL DEFAULT '课程',
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, filename) ON CONFLICT REPLACE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS prompt_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_key TEXT NOT NULL,
          value TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_revisions_key_created
          ON prompt_revisions(prompt_key, id DESC);
        CREATE TABLE IF NOT EXISTS generation_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          task_type TEXT NOT NULL,
          status TEXT NOT NULL,
          source_path TEXT,
          mode TEXT,
          model TEXT,
          prompt_version TEXT NOT NULL DEFAULT 'mobile-v1',
          input_hash TEXT NOT NULL DEFAULT '',
          output_path TEXT,
          error_message TEXT,
          progress_current INTEGER NOT NULL DEFAULT 0,
          progress_total INTEGER NOT NULL DEFAULT 1,
          stage_label TEXT,
          payload_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS qa_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          session_id INTEGER,
          parent_qa_id INTEGER,
          relation_type TEXT NOT NULL DEFAULT 'follow_up',
          source_type TEXT NOT NULL,
          source_path TEXT,
          display_title TEXT,
          selected_text TEXT NOT NULL DEFAULT '',
          question TEXT NOT NULL,
          answer_md TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          output_path TEXT,
          retrieval_trace TEXT,
          favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS highlights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          selected_text TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT 'yellow',
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS knowledge_nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          node_type TEXT NOT NULL,
          title TEXT NOT NULL,
          ref_type TEXT,
          ref_id INTEGER,
          ref_path TEXT,
          summary TEXT,
          x REAL,
          y REAL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS knowledge_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          source_node_id INTEGER NOT NULL,
          target_node_id INTEGER NOT NULL,
          relation_type TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY(source_node_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
          FOREIGN KEY(target_node_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS knowledge_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          term_text TEXT NOT NULL,
          qa_record_id INTEGER NOT NULL,
          node_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS document_terms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          term_text TEXT NOT NULL,
          detection_source TEXT NOT NULL DEFAULT 'rule',
          confidence REAL NOT NULL DEFAULT 0.5,
          status TEXT NOT NULL DEFAULT 'candidate',
          qa_record_id INTEGER,
          concept_id TEXT,
          content_hash TEXT,
          link_origin TEXT NOT NULL DEFAULT 'legacy_unknown',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, source_type, source_path, term_text) ON CONFLICT IGNORE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS learning_anchors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          qa_record_id INTEGER NOT NULL UNIQUE,
          term_text TEXT,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS learning_states (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'in_progress',
          position_kind TEXT NOT NULL DEFAULT 'scroll_ratio',
          position_value REAL NOT NULL DEFAULT 0,
          last_opened_at TEXT NOT NULL,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, source_type, source_path) ON CONFLICT REPLACE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_learning_states_project_opened
          ON learning_states(project_id, last_opened_at DESC);
        CREATE TABLE IF NOT EXISTS code_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          language TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          chunk_type TEXT NOT NULL DEFAULT 'block',
          symbol_name TEXT,
          content TEXT NOT NULL,
          generation INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS indexed_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          relative_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          mtime_ns INTEGER NOT NULL DEFAULT 0,
          content_hash TEXT,
          language TEXT NOT NULL,
          chunk_version INTEGER NOT NULL DEFAULT 1,
          indexed_at TEXT NOT NULL,
          UNIQUE(project_id, relative_path) ON CONFLICT REPLACE,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `,
      transaction: true,
      readonly: false,
    });
    for (const statement of [
      "ALTER TABLE document_terms ADD COLUMN concept_id TEXT",
      "ALTER TABLE document_terms ADD COLUMN content_hash TEXT",
      "ALTER TABLE document_terms ADD COLUMN link_origin TEXT NOT NULL DEFAULT 'legacy_unknown'",
    ]) {
      try {
        await CapacitorSQLite.execute({
          database: DATABASE,
          statements: statement,
          transaction: false,
          readonly: false,
        });
      } catch {
        // Existing installations already have the column.
      }
    }
    try {
      await CapacitorSQLite.execute({
        database: DATABASE,
        statements: "CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(project_id UNINDEXED, path, symbol_name, content);",
        transaction: false,
        readonly: false,
      });
      this.ftsVersion = 5;
    } catch {
      await CapacitorSQLite.execute({
        database: DATABASE,
        statements: "CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts4(project_id, path, symbol_name, content);",
        transaction: false,
        readonly: false,
      });
      this.ftsVersion = 4;
    }
    // Personalization tables
    await this.createPersonalizationSchema();
  }

  private async createPersonalizationSchema(): Promise<void> {
    await CapacitorSQLite.execute({
      database: DATABASE,
      statements: `
        CREATE TABLE IF NOT EXISTS concepts (
          id TEXT PRIMARY KEY,
          concept_key TEXT NOT NULL UNIQUE,
          canonical_name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          domain TEXT NOT NULL DEFAULT 'general',
          concept_type TEXT NOT NULL DEFAULT 'theory',
          aliases_json TEXT NOT NULL DEFAULT '[]',
          difficulty REAL NOT NULL DEFAULT 0.5,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_concepts_domain ON concepts(domain, canonical_name);
        CREATE TABLE IF NOT EXISTS concept_mastery (
          id TEXT PRIMARY KEY,
          concept_id TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          known_evidence REAL NOT NULL DEFAULT 1,
          unknown_evidence REAL NOT NULL DEFAULT 1,
          mastery REAL NOT NULL DEFAULT 0.5,
          uncertainty REAL NOT NULL DEFAULT 0.7071,
          manual_status TEXT,
          sequence INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(concept_id, scope_type, scope_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_concept_mastery_scope ON concept_mastery(scope_type, scope_id, concept_id);
        CREATE TABLE IF NOT EXISTS learning_events (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          schema_version INTEGER NOT NULL DEFAULT 1,
          concept_id TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          direction TEXT NOT NULL,
          strength REAL NOT NULL,
          source TEXT NOT NULL DEFAULT 'explicit_user',
          target_event_id TEXT,
          evidence_text TEXT,
          session_id TEXT,
          qa_record_id INTEGER,
          is_voided INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_learning_events_concept ON learning_events(concept_id, scope_type, scope_id, created_at);
        CREATE TABLE IF NOT EXISTS learner_preferences (
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          answer_depth REAL NOT NULL DEFAULT 0.5,
          code_ratio REAL NOT NULL DEFAULT 0.5,
          explanation_order TEXT NOT NULL DEFAULT 'balanced',
          prerequisite_detail REAL NOT NULL DEFAULT 0.5,
          terminology_density REAL NOT NULL DEFAULT 0.5,
          feedback_count INTEGER NOT NULL DEFAULT 0,
          survey_enabled INTEGER NOT NULL DEFAULT 1,
          last_survey_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(scope_type, scope_id)
        );
        CREATE TABLE IF NOT EXISTS preference_events (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          dimension TEXT NOT NULL,
          delta REAL NOT NULL,
          source TEXT NOT NULL,
          qa_record_id INTEGER,
          evidence_text TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_preference_events_scope
          ON preference_events(scope_type, scope_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS term_impressions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          concept_id TEXT,
          source_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          term_text TEXT NOT NULL,
          content_hash TEXT NOT NULL DEFAULT '',
          displayed_count INTEGER NOT NULL DEFAULT 0,
          opened_count INTEGER NOT NULL DEFAULT 0,
          feedback TEXT,
          display_style TEXT NOT NULL DEFAULT 'subtle',
          last_displayed_at TEXT,
          last_opened_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, source_type, source_path, term_text, content_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_term_impressions_source
          ON term_impressions(project_id, source_type, source_path);
        CREATE TABLE IF NOT EXISTS concept_relations (
          id TEXT PRIMARY KEY,
          source_concept_id TEXT NOT NULL,
          target_concept_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          domain TEXT NOT NULL DEFAULT 'general',
          confidence REAL NOT NULL DEFAULT 0.5,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          origin TEXT NOT NULL DEFAULT 'observer',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(source_concept_id, target_concept_id, relation_type)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_concept_relations_source
          ON concept_relations(source_concept_id, status);
        CREATE TABLE IF NOT EXISTS learner_inferences (
          id TEXT PRIMARY KEY,
          subject_type TEXT NOT NULL,
          subject_key TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          state TEXT NOT NULL,
          summary TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          direct_evidence_count INTEGER NOT NULL DEFAULT 0,
          inferred_evidence_count INTEGER NOT NULL DEFAULT 0,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(subject_type, subject_key, scope_type, scope_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_learner_inferences_scope
          ON learner_inferences(scope_type, scope_id, subject_type, status);
        CREATE TABLE IF NOT EXISTS domain_profiles (
          domain_key TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0,
          confirmed_json TEXT NOT NULL DEFAULT '[]',
          learning_json TEXT NOT NULL DEFAULT '[]',
          likely_prerequisites_json TEXT NOT NULL DEFAULT '[]',
          evidence_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(domain_key, scope_id)
        );
        CREATE TABLE IF NOT EXISTS concept_explanations (
          id TEXT PRIMARY KEY,
          concept_id TEXT NOT NULL,
          project_id INTEGER NOT NULL,
          qa_record_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(concept_id, qa_record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_concept_explanations
          ON concept_explanations(concept_id, status, updated_at DESC);
        CREATE TABLE IF NOT EXISTS survey_candidates (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL,
          question TEXT NOT NULL,
          dimension TEXT NOT NULL,
          options_json TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          observer_run_id TEXT,
          answer TEXT,
          created_at TEXT NOT NULL,
          answered_at TEXT,
          dismissed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_survey_candidates
          ON survey_candidates(scope_id, status, created_at DESC);
        CREATE TABLE IF NOT EXISTS model_call_audit (
          id TEXT PRIMARY KEY,
          project_id INTEGER,
          purpose TEXT NOT NULL,
          provider TEXT,
          model TEXT,
          status TEXT NOT NULL,
          input_tokens INTEGER,
          output_tokens INTEGER,
          estimated_cost REAL,
          latency_ms INTEGER,
          error_message TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_model_call_audit
          ON model_call_audit(created_at DESC);
        CREATE TABLE IF NOT EXISTS term_model_scans (
          project_id INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          terms_json TEXT NOT NULL DEFAULT '[]',
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(project_id, source_type, source_path, content_hash)
        );
        CREATE TABLE IF NOT EXISTS learning_evidence_v2 (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          schema_version INTEGER NOT NULL DEFAULT 2,
          concept_id TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          dimension TEXT NOT NULL,
          direction TEXT NOT NULL,
          strength REAL NOT NULL,
          reliability REAL NOT NULL,
          source TEXT NOT NULL,
          action TEXT NOT NULL,
          object_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT NOT NULL DEFAULT '{}',
          context_json TEXT NOT NULL DEFAULT '{}',
          event_time TEXT NOT NULL,
          session_id TEXT,
          qa_record_id INTEGER,
          diagnostic_attempt_id TEXT,
          objective_correct INTEGER,
          target_evidence_id TEXT,
          voided INTEGER NOT NULL DEFAULT 0,
          model_version TEXT,
          policy_version TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_learning_evidence_v2_replay
          ON learning_evidence_v2(concept_id, scope_type, scope_id, event_time, id);
        CREATE TABLE IF NOT EXISTS knowledge_states_v2 (
          concept_id TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          state_json TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          evidence_version INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(concept_id, scope_type, scope_id)
        );
        CREATE TABLE IF NOT EXISTS diagnostic_items (
          id TEXT PRIMARY KEY,
          project_id INTEGER NOT NULL,
          session_id TEXT,
          source_qa_record_id INTEGER,
          teaching_trial_id TEXT,
          concept_ids_json TEXT NOT NULL,
          dimension TEXT NOT NULL,
          item_type TEXT NOT NULL,
          prompt TEXT NOT NULL,
          options_json TEXT NOT NULL DEFAULT '[]',
          answer_key_json TEXT NOT NULL,
          source_refs_json TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          difficulty REAL NOT NULL DEFAULT 0.5,
          strategy_version TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          shown_at TEXT,
          dismissed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_diagnostic_items_pending
          ON diagnostic_items(project_id, status, created_at DESC);
        CREATE TABLE IF NOT EXISTS diagnostic_attempts (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          project_id INTEGER NOT NULL,
          session_id TEXT,
          teaching_trial_id TEXT,
          answer_json TEXT NOT NULL,
          is_correct INTEGER,
          user_flagged INTEGER NOT NULL DEFAULT 0,
          evidence_ids_json TEXT NOT NULL DEFAULT '[]',
          answered_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS observer_jobs (
          id TEXT PRIMARY KEY,
          project_id INTEGER NOT NULL,
          qa_record_id INTEGER NOT NULL,
          reason TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          available_at TEXT NOT NULL,
          locked_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, qa_record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_observer_jobs_ready
          ON observer_jobs(status, available_at);
        CREATE TABLE IF NOT EXISTS teaching_trials (
          id TEXT PRIMARY KEY,
          project_id INTEGER NOT NULL,
          session_id INTEGER,
          qa_record_id INTEGER NOT NULL,
          planner_run_id TEXT,
          snapshot_id TEXT,
          teaching_plan_id TEXT,
          effective_context_json TEXT,
          mode TEXT NOT NULL DEFAULT 'default',
          was_applied INTEGER NOT NULL DEFAULT 0,
          fallback_reason TEXT,
          answer_model TEXT,
          previous_outcome TEXT,
          pre_state_json TEXT NOT NULL DEFAULT '{}',
          target_concepts_json TEXT NOT NULL DEFAULT '[]',
          target_dimensions_json TEXT NOT NULL DEFAULT '[]',
          strategy_rationale TEXT NOT NULL DEFAULT '',
          policy_version TEXT NOT NULL DEFAULT 'teaching-trial-v2.1',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_teaching_trials_qa
          ON teaching_trials(project_id, qa_record_id);
        CREATE TABLE IF NOT EXISTS teaching_outcomes (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          project_id INTEGER NOT NULL,
          session_id INTEGER,
          teaching_trial_id TEXT NOT NULL,
          taught_qa_record_id INTEGER NOT NULL,
          evaluation_qa_record_id INTEGER NOT NULL,
          result TEXT NOT NULL,
          confidence REAL NOT NULL,
          reason TEXT NOT NULL,
          evidence_quote TEXT NOT NULL,
          source_observation_id TEXT,
          observer_run_id TEXT,
          evidence_type TEXT NOT NULL DEFAULT 'observer_inference',
          evidence_ref_id TEXT,
          authority INTEGER NOT NULL DEFAULT 20,
          policy_eligible INTEGER NOT NULL DEFAULT 0,
          diagnostic_attempt_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_teaching_outcomes_trial
          ON teaching_outcomes(teaching_trial_id);
        CREATE INDEX IF NOT EXISTS idx_mobile_teaching_outcomes_session
          ON teaching_outcomes(project_id, session_id, evaluation_qa_record_id);
        INSERT OR IGNORE INTO learning_evidence_v2
          (id, idempotency_key, schema_version, concept_id, scope_type, scope_id,
           dimension, direction, strength, reliability, source, action,
           object_json, result_json, context_json, event_time, voided,
           policy_version)
        SELECT
          'migration:v2:manual:' || scope_type || ':' || scope_id || ':' ||
            concept_id || ':' || manual_status,
          'migration:v2:manual:' || scope_type || ':' || scope_id || ':' ||
            concept_id || ':' || manual_status,
          2, concept_id, scope_type, scope_id, 'familiarity',
          CASE WHEN manual_status='known' THEN 'positive' ELSE 'negative' END,
          1, 1, 'manual',
          CASE WHEN manual_status='known' THEN 'manual_known' ELSE 'manual_unknown' END,
          '{}', '{}', '{"migrated_from":"concept_mastery"}', updated_at, 0,
          'knowledge-v2.1'
        FROM concept_mastery
        WHERE manual_status IN ('known', 'unknown');
      `,
      transaction: true,
      readonly: false,
    });
    for (const statement of [
      "ALTER TABLE diagnostic_items ADD COLUMN teaching_trial_id TEXT",
      "ALTER TABLE diagnostic_attempts ADD COLUMN teaching_trial_id TEXT",
      "ALTER TABLE teaching_trials ADD COLUMN pre_state_json TEXT NOT NULL DEFAULT '{}'",
      "ALTER TABLE teaching_trials ADD COLUMN target_concepts_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE teaching_trials ADD COLUMN target_dimensions_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE teaching_trials ADD COLUMN strategy_rationale TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE teaching_trials ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'teaching-trial-v2.1'",
      "ALTER TABLE teaching_outcomes ADD COLUMN evidence_type TEXT NOT NULL DEFAULT 'observer_inference'",
      "ALTER TABLE teaching_outcomes ADD COLUMN evidence_ref_id TEXT",
      "ALTER TABLE teaching_outcomes ADD COLUMN authority INTEGER NOT NULL DEFAULT 20",
      "ALTER TABLE teaching_outcomes ADD COLUMN policy_eligible INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE teaching_outcomes ADD COLUMN diagnostic_attempt_id TEXT",
    ]) {
      try {
        await CapacitorSQLite.execute({
          database: DATABASE,
          statements: statement,
          transaction: false,
          readonly: false,
        });
      } catch {
        // Existing installations already have the column.
      }
    }
  }

  async query<T extends Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    await this.init();
    const result = await CapacitorSQLite.query({ database: DATABASE, statement, values, readonly: false });
    return (result.values ?? []) as T[];
  }

  async run(statement: string, values: unknown[] = []): Promise<number> {
    await this.init();
    const result = await CapacitorSQLite.run({ database: DATABASE, statement, values, transaction: true, readonly: false });
    return result.changes?.lastId ?? 0;
  }

  async execute(statements: string): Promise<void> {
    await this.init();
    await CapacitorSQLite.execute({ database: DATABASE, statements, transaction: true, readonly: false });
  }

  /**
   * Execute a callback within an explicit transaction.
   * On error, rolls back automatically.
   * Returns the callback's result.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.init();
    await CapacitorSQLite.execute({ database: DATABASE, statements: "BEGIN IMMEDIATE", transaction: false, readonly: false });
    try {
      const result = await fn();
      await CapacitorSQLite.execute({ database: DATABASE, statements: "COMMIT", transaction: false, readonly: false });
      return result;
    } catch (error) {
      await CapacitorSQLite.execute({ database: DATABASE, statements: "ROLLBACK", transaction: false, readonly: false });
      throw error;
    }
  }

  /**
   * Run a single statement within an already-open transaction.
   * Use inside transaction() callback for multi-step atomic operations.
   */
  async runInTx(statement: string, values: unknown[] = []): Promise<number> {
    const result = await CapacitorSQLite.run({ database: DATABASE, statement, values, transaction: false, readonly: false });
    return result.changes?.lastId ?? 0;
  }

  /**
   * Query within an already-open transaction.
   */
  async queryInTx<T extends Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    const result = await CapacitorSQLite.query({ database: DATABASE, statement, values, readonly: false });
    return (result.values ?? []) as T[];
  }

  get searchVersion(): 4 | 5 {
    return this.ftsVersion;
  }
}
