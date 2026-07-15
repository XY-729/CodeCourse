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
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `,
      transaction: true,
      readonly: false,
    });
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

  get searchVersion(): 4 | 5 {
    return this.ftsVersion;
  }
}
