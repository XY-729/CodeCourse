"""Local, explicit maintenance records; no model or familiarity inference."""


def initialize(conn):
    for statement in (
        """CREATE TABLE IF NOT EXISTS project_concept_links (
            project_id INTEGER NOT NULL,concept_id TEXT NOT NULL,source_type TEXT NOT NULL,
            source_path TEXT NOT NULL,PRIMARY KEY(project_id,concept_id,source_type,source_path))""",
        """CREATE TABLE IF NOT EXISTS concept_redirects (
            source_id TEXT PRIMARY KEY,target_id TEXT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS learning_range_aliases (
            concept_id TEXT NOT NULL,dimension TEXT NOT NULL,alias TEXT NOT NULL,
            canonical TEXT NOT NULL,aspect_id TEXT NOT NULL,
            PRIMARY KEY(concept_id,dimension,alias))""",
        """CREATE TABLE IF NOT EXISTS knowledge_changes (
            id TEXT PRIMARY KEY,project_id INTEGER NOT NULL,kind TEXT NOT NULL,
            affected_json TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS teaching_backfills (
            id TEXT PRIMARY KEY,project_id INTEGER NOT NULL,source_type TEXT NOT NULL,
            source_path TEXT NOT NULL,content_hash TEXT NOT NULL,manifest_json TEXT NOT NULL,
            tree_json TEXT NOT NULL,status TEXT NOT NULL,change_id TEXT,created_at TEXT NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS teaching_manifest_overrides (
            project_id INTEGER NOT NULL,source_type TEXT NOT NULL,source_path TEXT NOT NULL,
            content_hash TEXT NOT NULL,manifest_json TEXT NOT NULL,
            PRIMARY KEY(project_id,source_type,source_path))""",
        """CREATE TABLE IF NOT EXISTS teaching_concept_overrides (
            project_id INTEGER NOT NULL,source_type TEXT NOT NULL,source_path TEXT NOT NULL,
            content_hash TEXT NOT NULL,quote TEXT NOT NULL,source_concept_id TEXT NOT NULL,
            target_concept_id TEXT NOT NULL,
            PRIMARY KEY(project_id,source_type,source_path,content_hash,quote,source_concept_id))""",
    ):
        conn.execute(statement)
    # Source ownership is explicit even for globally reusable identities. This
    # upgrade can run repeatedly after an old archive is imported.
    for table in ("teaching_passages", "teaching_terms"):
        conn.execute(f"""INSERT OR IGNORE INTO project_concept_links
            SELECT d.project_id,COALESCE(r.target_id,p.concept_id),d.source_type,d.source_path FROM {table} p
            JOIN teaching_documents d ON d.id=p.document_id LEFT JOIN concept_redirects r ON r.source_id=p.concept_id""")
    for table in ("document_terms", "concept_explanations"):
        conn.execute(f"""INSERT OR IGNORE INTO project_concept_links
            SELECT p.project_id,COALESCE(r.target_id,p.concept_id),'legacy','' FROM {table} p
            LEFT JOIN concept_redirects r ON r.source_id=p.concept_id WHERE p.concept_id IS NOT NULL""")
    conn.execute("""INSERT OR IGNORE INTO project_concept_links
        SELECT project_id,root_concept_id,'root','' FROM project_knowledge_roots""")
