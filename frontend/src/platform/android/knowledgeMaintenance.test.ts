// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { MobileDatabase } from './database';
import { KNOWLEDGE_FOREST_SCHEMA } from './knowledgeForestSchema';
import { TEACHING_SCHEMA } from './teachingSchema';
import { KnowledgeForest } from './knowledgeForest';
import { TeachingIndex } from './teachingIndex';
import { AndroidKnowledgeMaintenance } from './knowledgeMaintenance';
import { appendTeachingManifest } from './teachingManifest';
import { hashText } from './learningRanges';
import type { TeachingManifestV2 } from '../../personalization/teachingManifest';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const concept = (ref: string, name: string, parent: string | null = null) => ({ref,name,existing_id:null,domain:'cpp',scope:'global' as const,parent_ref:parent,aliases:[]});
const manifest = (concepts: TeachingManifestV2['concepts']): TeachingManifestV2 => ({schema_version:2,concepts,coverage:[],terms:[],placement_changes:[]});
function fixture() {
  const sql = new DatabaseSync(':memory:'); databases.push(sql);
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,project_type TEXT);
    INSERT INTO projects VALUES(1,'one','learning_plan'),(2,'two','learning_plan');
    CREATE TABLE concepts(id TEXT PRIMARY KEY,concept_key TEXT UNIQUE,canonical_name TEXT,display_name TEXT,domain TEXT,concept_type TEXT,aliases_json TEXT,difficulty REAL,created_at TEXT,scope_type TEXT DEFAULT 'global',scope_id TEXT DEFAULT 'local-user');
    CREATE TABLE learning_evidence_v2(id TEXT PRIMARY KEY,idempotency_key TEXT,schema_version INTEGER,concept_id TEXT,scope_type TEXT,scope_id TEXT,dimension TEXT,direction TEXT,strength REAL,reliability REAL,source TEXT,action TEXT,object_json TEXT,result_json TEXT,context_json TEXT,event_time TEXT,voided INTEGER DEFAULT 0,target_evidence_id TEXT,qa_record_id INTEGER,session_id TEXT,policy_version TEXT);
    CREATE TABLE knowledge_states_v2(concept_id TEXT,scope_type TEXT,scope_id TEXT,state_json TEXT);
    CREATE TABLE learning_states(project_id INTEGER,source_type TEXT,source_path TEXT,status TEXT,completed_at TEXT);
    CREATE TABLE qa_records(id INTEGER PRIMARY KEY,project_id INTEGER);
  `);
  sql.exec(TEACHING_SCHEMA); sql.exec(KNOWLEDGE_FOREST_SCHEMA);
  const query = async <T,>(statement: string, values: unknown[] = []) => sql.prepare(statement).all(...values as never[]) as T[];
  const run = async (statement: string, values: unknown[] = []) => Number(sql.prepare(statement).run(...values as never[]).lastInsertRowid);
  let inTransaction = false;
  const db = {query,queryInTx:query,run:async (statement: string, values: unknown[] = []) => {
    if (inTransaction) throw new Error('Cannot enqueue a serialized write inside its own transaction');
    return run(statement,values);
  },runInTx:run,transaction:async <T,>(work: () => Promise<T>) => {
    sql.exec('BEGIN IMMEDIATE'); inTransaction = true;
    try { const result = await work(); sql.exec('COMMIT'); return result; } catch (e) { sql.exec('ROLLBACK'); throw e; }
    finally { inTransaction = false; }
  }} as unknown as MobileDatabase;
  const forest = new KnowledgeForest(db), content = new Map<string,string>();
  const read = async (project: number, _type: string, path: string) => { const text=content.get(`${project}:${path}`); if (text == null) throw new Error('来源已删除'); return text; };
  const teaching = new TeachingIndex(db,{read,manifest:(p,t,path)=>forest.manifest(p,t,path),evidence:async()=>{throw new Error('unexpected evidence');},stateChanged:()=>forest.bumpState()});
  let output = '';
  const maintenance = new AndroidKnowledgeMaintenance(db,forest,teaching,{read,model:async()=>output,evidence:async()=>{throw new Error('unexpected completion');}});
  const correct = async (id: string, action: string, fields: Record<string,unknown>) => maintenance.correct(1,id,{action,topology_version:(await forest.versionsFor(1)).topologyVersion,...fields});
  return { sql,db,forest,teaching,maintenance,content,correct,setOutput:(text:string)=>{output=text;} };
}

describe('Android knowledge maintenance', () => {
  it('moves, renames, rejects cycles and undoes with foreign keys enabled', async () => {
    const f=fixture(), ids=await f.forest.applyManifest(1,manifest([concept('r','C++'),concept('s','STL','r'),concept('v','vector','r')]));
    const moved=await f.correct(ids.get('v')!,'move',{parent_id:ids.get('s')});
    expect((await f.forest.snapshot(1)).concepts.find(n=>n.id===ids.get('v'))?.parent_id).toBe(ids.get('s'));
    await f.maintenance.undo(1,moved.changeId);
    const renamed=await f.correct(ids.get('v')!,'rename',{name:'std::vector'});
    expect((await f.forest.snapshot(1)).concepts.find(n=>n.id===ids.get('v'))?.name).toBe('std::vector');
    await f.maintenance.undo(1,renamed.changeId);
    await expect(f.correct(ids.get('r')!,'move',{parent_id:ids.get('v')})).rejects.toThrow('循环');
  });

  it('previews/applies/undoes sidecar metadata without changing source bytes', async () => {
    const f=fixture(), body='vector 在扩容时会分配新的连续内存空间。';
    f.content.set('1:legacy.md',body);
    const m=manifest([concept('v','vector')]);
    m.coverage=[{concept_ref:'v',aspect:'扩容机制',dimension:'conceptual',kind:'explained',core:true,quote:body}];
    m.terms=[{concept_ref:'v',text:'vector',quote:body}];
    f.setOutput('TEACHING: '+JSON.stringify(m));
    const preview=await f.maintenance.prepare(1,{sourceType:'course',sourcePath:'legacy.md'});
    expect((await f.forest.snapshot(1)).concepts).toHaveLength(0);
    const applied=await f.maintenance.apply(1,preview.id);
    expect(f.content.get('1:legacy.md')).toBe(body);
    expect((await f.teaching.document(1,'course','legacy.md')).schemaVersion).toBe(2);
    await f.maintenance.undo(1,applied.changeId);
    expect((await f.forest.snapshot(1)).concepts).toHaveLength(0);
    expect(f.content.get('1:legacy.md')).toBe(body);
  });

  it('merges identities, preserves old model references and rejects stale undo', async () => {
    const f=fixture(), ids=await f.forest.applyManifest(1,manifest([concept('v','vector'),concept('s','std::vector')]));
    const changed=await f.correct(ids.get('v')!,'merge',{target_id:ids.get('s')});
    const reused=manifest([{...concept('v','vector'),existing_id:ids.get('v')!}]);
    expect((await f.forest.applyManifest(1,reused)).get('v')).toBe(ids.get('s'));
    await f.maintenance.undo(1,changed.changeId);
    expect((await f.forest.snapshot(1)).concepts).toHaveLength(2);
    const renamed=await f.correct(ids.get('v')!,'rename',{name:'vector 容器'});
    await f.forest.applyManifest(2,manifest([{...concept('v','vector 容器'),existing_id:ids.get('v')!}]));
    await expect(f.maintenance.undo(1,renamed.changeId)).rejects.toThrow('后续变化');
  });

  it('removes exclusive nodes and keeps a shared branch and its ancestors', async () => {
    const f=fixture(), ids=await f.forest.applyManifest(1,manifest([concept('r','C++'),concept('v','vector','r'),concept('u','Unique','r')]));
    await f.forest.applyManifest(2,manifest([concept('r','C++'),concept('v','vector','r')]));
    await f.maintenance.deleteProject(1);
    const remaining=(await f.forest.snapshot(2)).concepts.map(n=>n.id);
    expect(remaining).toContain(ids.get('r')); expect(remaining).toContain(ids.get('v')); expect(remaining).not.toContain(ids.get('u'));
  });

  it('keeps split quote corrections after reindex and permits undo before later writes', async () => {
    const f=fixture(), body='vector 在扩容时会分配新的连续内存空间。';
    const m=manifest([concept('v','vector')]); m.coverage=[{concept_ref:'v',aspect:'扩容原理',dimension:'conceptual',kind:'explained',core:true,quote:body}];
    const text=appendTeachingManifest(body,m); f.content.set('1:lesson.md',text);
    const published=await f.forest.publish(1,{sourceType:'course',sourcePath:'lesson.md',artifactKind:'lesson',contentHash:await hashText(text),generationId:'g',body,manifest:m});
    const state=await f.teaching.document(1,'course','lesson.md');
    const changed=await f.correct(published.conceptMap.get('v')!,'split',{name:'vector 扩容',passage_ids:[state.passages[0].id]});
    const fresh=(await f.teaching.document(1,'course','lesson.md')).passages[0].concept_id;
    expect(fresh).not.toBe(published.conceptMap.get('v'));
    await f.forest.snapshot(1);
    await f.maintenance.undo(1,changed.changeId);
    expect((await f.teaching.document(1,'course','lesson.md')).passages[0].concept_id).toBe(published.conceptMap.get('v'));
    await f.correct(published.conceptMap.get('v')!,'split',{name:'vector 扩容',passage_ids:[state.passages[0].id]});
    const final=(await f.teaching.document(1,'course','lesson.md')).passages[0].concept_id;
    await f.teaching.index(1,'course','lesson.md',text,{force:true});
    expect((await f.teaching.document(1,'course','lesson.md')).passages[0].concept_id).toBe(final);
  });
});
