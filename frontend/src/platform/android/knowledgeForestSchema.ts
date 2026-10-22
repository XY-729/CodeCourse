/** Android schema v8. Names and snake_case columns are part of the portable archive contract. */
export const KNOWLEDGE_FOREST_TABLES = [
  "concept_placements", "concept_aliases", "plan_concept_roots", "plan_root_status",
  "knowledge_tree_versions", "teaching_manifests", "knowledge_topology_conflicts",
  "user_teaching_requirements",
] as const;

export const KNOWLEDGE_FOREST_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_tree_versions (
  id INTEGER PRIMARY KEY CHECK(id=1),
  topology_version INTEGER NOT NULL DEFAULT 0,
  state_version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO knowledge_tree_versions(id,topology_version,state_version) VALUES(1,0,0);
CREATE TABLE IF NOT EXISTS concept_placements (
  concept_id TEXT PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  parent_concept_id TEXT REFERENCES concepts(id) ON DELETE RESTRICT,
  placement_status TEXT NOT NULL DEFAULT 'pending' CHECK(placement_status IN ('root','placed','pending')),
  provenance_json TEXT NOT NULL DEFAULT '{}',
  CHECK((placement_status='placed' AND parent_concept_id IS NOT NULL)
    OR (placement_status IN ('root','pending') AND parent_concept_id IS NULL)),
  CHECK(concept_id<>parent_concept_id)
);
CREATE INDEX IF NOT EXISTS idx_concept_placements_parent ON concept_placements(parent_concept_id);
CREATE TABLE IF NOT EXISTS concept_aliases (
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','project')),
  scope_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  PRIMARY KEY(scope_type,scope_id,domain,alias_key)
);
CREATE TABLE IF NOT EXISTS plan_concept_roots (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE RESTRICT,
  PRIMARY KEY(project_id,concept_id)
);
CREATE TABLE IF NOT EXISTS plan_root_status (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS teaching_manifests (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  concept_map_json TEXT NOT NULL DEFAULT '{}',
  topology_version INTEGER NOT NULL DEFAULT 0,
  state_version INTEGER NOT NULL DEFAULT 0,
  metadata_status TEXT NOT NULL CHECK(metadata_status IN ('complete','pending','invalid','legacy')),
  error_message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,source_type,source_path)
);
CREATE TABLE IF NOT EXISTS knowledge_topology_conflicts (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  expected_topology_version INTEGER,
  actual_topology_version INTEGER NOT NULL,
  from_parent_id TEXT,
  to_parent_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(project_id,concept_id,expected_topology_version,actual_topology_version,from_parent_id,to_parent_id,reason)
);
CREATE TABLE IF NOT EXISTS user_teaching_requirements (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Repeated after legacy import too. No taxonomy, familiarity, or AI is invented by migration. */
export const KNOWLEDGE_FOREST_LEGACY_NORMALIZATION = `
INSERT OR IGNORE INTO knowledge_tree_versions(id,topology_version,state_version) VALUES(1,0,0);
UPDATE concepts SET scope_type=CASE WHEN concept_key LIKE 'project:%' THEN 'project' ELSE 'global' END,
  scope_id=CASE WHEN concept_key LIKE 'project:%'
    THEN substr(concept_key,9,instr(substr(concept_key,9),':')-1) ELSE 'local-user' END;
INSERT OR IGNORE INTO concept_placements(concept_id,parent_concept_id,placement_status,provenance_json)
  SELECT id,NULL,'pending','{"origin":"legacy_migration","classification_only":true}' FROM concepts;
INSERT OR IGNORE INTO plan_root_status(project_id,status)
  SELECT id,'pending' FROM projects WHERE project_type='learning_plan';
INSERT OR REPLACE INTO settings(key,value) VALUES('personalization.enabled','true');
INSERT OR REPLACE INTO settings(key,value) VALUES('personalization.observer.enabled','true');
UPDATE observer_jobs SET status='retired',locked_at=NULL WHERE status IN ('pending','running','failed');
UPDATE diagnostic_items SET status='retired' WHERE status IN ('pending','shown');
UPDATE survey_candidates SET status='retired' WHERE status='pending';
UPDATE qa_postprocess_jobs SET planner_done=1,observer_done=1;
`;
