import type { MobileDatabase } from './database';
import { stableSerialize } from '../../personalization/conceptForest';
export type RangeRow = { concept_id: string; dimension: string; alias: string; canonical: string; aspect_id: string };
export const rangeKey = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export async function hashText(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function canonicalRange(rows: RangeRow[], concept: string, dimension: string, aspect: string, provided?: string): string {
  const owned = rows.filter(r => r.concept_id === concept && r.dimension === dimension);
  const match = owned.find(r => provided ? r.aspect_id === provided : r.alias === rangeKey(aspect));
  if (provided && !match) throw new Error('范围编号不属于该概念与维度，请刷新后重试');
  return match?.canonical ?? aspect.trim();
}
export async function ensureRange(db: MobileDatabase, concept: string, dimension: string, aspect: string, provided?: string, inTx = false) {
  const query = inTx ? db.queryInTx.bind(db) : db.query.bind(db), run = inTx ? db.runInTx.bind(db) : db.run.bind(db);
  const rows = await query<RangeRow>('SELECT * FROM learning_range_aliases WHERE concept_id=? AND dimension=?', [concept, dimension]);
  if (provided && !rows.some(row => row.aspect_id === provided)) {
    const former = await query<{ canonical: string }>('SELECT a.canonical FROM learning_range_aliases a JOIN concept_redirects r ON r.source_id=a.concept_id WHERE a.aspect_id=? AND a.dimension=? AND r.target_id=?', [provided, dimension, concept]);
    if (former.length) return ensureRange(db, concept, dimension, former[0].canonical, undefined, inTx);
  }
  const canonical = canonicalRange(rows, concept, dimension, aspect, provided);
  const old = rows.find(r => r.alias === rangeKey(aspect));
  const identity = rows.find(r => r.canonical === canonical)?.aspect_id ?? 'r_' + (await hashText(`${concept}\0${dimension}\0${rangeKey(canonical)}`)).slice(0, 16);
  if (old && old.aspect_id !== identity) throw new Error('范围同义关联冲突，请明确合并');
  for (const alias of new Set([rangeKey(canonical), rangeKey(aspect)])) await run('INSERT OR IGNORE INTO learning_range_aliases VALUES(?,?,?,?,?)', [concept, dimension, alias, canonical, identity]);
  return { aspect: canonical, aspect_id: identity };
}
export function rangeCatalog(rows: RangeRow[], concept: string) {
  const result = new Map<string, { aspect_id: string; aspect: string; dimension: string; aliases: string[] }>();
  for (const row of rows.filter(r => r.concept_id === concept)) {
    const item = result.get(row.aspect_id) ?? { aspect_id: row.aspect_id, aspect: row.canonical, dimension: row.dimension, aliases: [] };
    if (row.alias !== rangeKey(row.canonical)) item.aliases.push(row.alias);
    result.set(row.aspect_id, item);
  }
  return [...result.values()].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)));
}
export function canonicalEvidence<T>(events: T[], rows: RangeRow[]): T[] {
  return events.map(event => {
    const e = structuredClone(event) as T & { conceptId: string; dimension: string; result: Record<string, unknown> };
    if (e.result.aspect) e.result.aspect = canonicalRange(rows, e.conceptId, e.dimension, String(e.result.aspect));
    for (const field of ['range', 'ranges']) {
      const value = e.result[field];
      for (const entry of (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []) as Array<Record<string, unknown>>) {
        if (entry.aspect) entry.aspect = canonicalRange(rows, e.conceptId, String(entry.dimension ?? e.dimension), String(entry.aspect));
      }
    }
    return e;
  });
}
