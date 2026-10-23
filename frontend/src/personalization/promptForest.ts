import { stableSerialize, type ConceptForestSnapshot } from "./conceptForest";

export const PROMPT_FOREST_INSTRUCTION = "知识树采用 compact-v1：columns 定义每行各列，末列可省略；省略属性使用 defaults。id/parent_id 为稳定短编号，完整包含所有可见概念；返回的 existing_id、from_parent_id 直接使用这些短编号，软件在校验时还原真实身份。不要凭编号推断含义。knowledge_state 未列出的节点使用默认状态；空范围不表示已掌握。";

const idCache = new Map<string, Promise<string>>();
export function promptId(identity: string): Promise<string> {
  let result = idCache.get(identity);
  if (!result) {
    result = crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)).then(bytes =>
      "c_" + btoa(String.fromCharCode(...new Uint8Array(bytes).slice(0, 6))).replace(/\+/g, "-").replace(/\//g, "_"));
    idCache.set(identity, result);
    // A long-running session must not retain deleted concepts indefinitely.
    if (idCache.size > 20_000) idCache.delete(idCache.keys().next().value!);
  }
  return result;
}

export async function promptIdLookup(identities: Iterable<string>): Promise<Map<string, string>> {
  const ids = new Set(identities);
  const pairs = await Promise.all([...ids].sort().map(async id => [await promptId(id), id] as const));
  const lookup = new Map<string, string>();
  for (const [short, id] of pairs) {
    if (lookup.has(short) || ids.has(short)) throw new Error("知识树短编号冲突，已停止发送，原身份未改变");
    lookup.set(short, id);
  }
  return lookup;
}

/** Only protocol identity fields are expanded; prose/quotes/local refs stay exact. */
export async function expandPromptReferences<T>(value: T, identities: Iterable<string>): Promise<T> {
  const lookup = await promptIdLookup(identities);
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key,
      ["existing_id", "from_parent_id"].includes(key) && typeof child === "string" ? lookup.get(child) ?? child : visit(child)]));
    return item;
  };
  return visit(value) as T;
}

/** Full model view, distinct from the persistent/export snapshot representation. */
export async function serializePromptForest(snapshot: ConceptForestSnapshot): Promise<string> {
  const nodes = [...snapshot.concepts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const lookup = await promptIdLookup(nodes.map(node => node.id));
  const short = new Map([...lookup].map(([alias, id]) => [id, alias]));
  const counts = new Map<string, number>();
  let domain = "general", most = 0;
  for (const node of nodes) {
    const count = (counts.get(node.domain) ?? 0) + 1; counts.set(node.domain, count);
  }
  for (const [label, count] of counts) if (count > most) { domain = label; most = count; }
  const defaults = { domain, scope: "global", project_id: null, aliases: [] };
  const topology = nodes.map(node => {
    const options = Object.fromEntries(Object.entries({ domain: node.domain, scope: node.scope,
      project_id: node.project_id ?? null, aliases: [...node.aliases].sort() }).filter(([key, value]) =>
        stableSerialize(value) !== stableSerialize(defaults[key as keyof typeof defaults])));
    if (node.parent_id && !short.has(node.parent_id)) throw new Error("完整知识树缺少父节点；未截取节点");
    const row: unknown[] = [short.get(node.id), node.name, node.parent_id ? short.get(node.parent_id) : null];
    if (Object.keys(options).length) row.push(options);
    return row;
  });
  const stateDefaults = { familiarity: "unrecorded", ranges: [], coverage: [], range_catalog: [] };
  const states = nodes.flatMap(node => {
    const options = Object.fromEntries(Object.entries({ familiarity: node.familiarity, range_catalog: node.range_catalog ?? [],
      ranges: [...node.ranges].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
      coverage: [...node.coverage].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
    }).filter(([key, value]) => stableSerialize(value) !== stableSerialize(stateDefaults[key as keyof typeof stateDefaults])));
    return Object.keys(options).length ? [[short.get(node.id), options]] : [];
  });
  const roots = snapshot.plan_roots.map(root => ({ ...root,
    root_concept_ids: [...root.root_concept_ids].sort().map(id => short.get(id) ?? id),
  })).sort((a, b) => a.project_id - b.project_id);
  // Keep rows before version suffixes and changing state, for prompt caching.
  const encode = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return encode({ format: "compact-v1", columns: ["id", "name", "parent_id", "optional_fields"], defaults,
    nodes: topology, topology_version: snapshot.topology_version, plan_roots: roots,
    knowledge_state: { defaults: stateDefaults, nodes: states, state_version: snapshot.state_version } });
}
