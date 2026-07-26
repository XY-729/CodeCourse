// ============================================================
// Concept resolver — maps user-visible terms to conceptKey + ConceptId.
// Shared between Desktop and Android.
// ============================================================

import type { ConceptId } from "./types";

export interface ResolvedConcept {
  conceptId: ConceptId;
  conceptKey: string;
  canonicalName: string;
  displayName: string;
  domain: string;
  aliases: string[];
  difficulty: number;
  /** Whether this concept was newly created during resolution */
  isNew: boolean;
}

export interface ConceptResolver {
  /** Resolve a term to its concept, creating if needed */
  resolve(term: string, context: ConceptResolutionContext): Promise<ResolvedConcept>;
  /** Batch resolve */
  resolveBatch(terms: string[], context: ConceptResolutionContext): Promise<Map<string, ResolvedConcept>>;
  /** Look up by conceptKey without creating */
  lookup(key: string): Promise<ResolvedConcept | null>;
}

export interface ConceptResolutionContext {
  projectId: number;
  /** For project symbols: qualified name, file path, or symbol kind */
  symbolHint?: { qualifiedName?: string; filePath?: string; kind?: string };
  /** Domain hint: "frontend", "backend", "database", "android", "general" */
  domain?: string;
}

/**
 * Build a conceptKey following the naming convention.
 *
 * global:<domain>:<normalized-name>       for general tech terms
 * project:<projectId>:symbol:<qualified>  for project symbols
 */
export function buildConceptKey(
  namespace: "global" | "project",
  domainOrProjectId: string,
  name: string,
): string {
  if (namespace === "project") {
    return `project:${domainOrProjectId}:symbol:${name}`;
  }
  return `global:${domainOrProjectId}:${name}`;
}

/**
 * Normalize a term for concept lookup: lowercase, trim, collapse whitespace.
 */
export function normalizeTerm(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_.]/g, "");
}

/**
 * Guess the domain for a term based on common patterns.
 */
export function guessDomain(term: string, context: ConceptResolutionContext): string {
  if (context.domain) return context.domain;
  // Simple heuristics
  const t = term.toLowerCase();
  if (/^(react|vue|angular|svelte|next\.js|vite|webpack|babel|eslint|prettier|jsx|css|html|dom)/.test(t)) return "frontend";
  if (/^(fastapi|django|flask|express|spring|gin|rails|nestjs|graphql|rest|grpc|http)/.test(t)) return "backend";
  if (/^(sqlite|postgresql|mysql|mongodb|redis|fts5|index|transaction|acid|orm|migration)/.test(t)) return "database";
  if (/^(android|activity|fragment|webview|capacitor|gradle|kotlin|java\.)/.test(t)) return "android";
  if (/^(electron|tauri|swift|ios|windows|linux)/.test(t)) return "desktop";
  if (/^(algorithm|data.structure|big.o|recursion|closure|async|thread|mutex|semaphore|design.pattern)/.test(t)) return "theory";
  return "general";
}

/**
 * Create a conceptKey for a generic tech term.
 */
export function globalConceptKey(term: string, context: ConceptResolutionContext): string {
  const domain = guessDomain(term, context);
  const normalized = normalizeTerm(term);
  return buildConceptKey("global", domain, normalized);
}

/**
 * Create a conceptKey for a project symbol.
 * Uses qualified name if available, otherwise filePath:name.
 */
export function projectConceptKey(term: string, context: ConceptResolutionContext): string {
  const hint = context.symbolHint;
  let qualified: string;
  if (hint?.qualifiedName) {
    qualified = normalizeTerm(hint.qualifiedName);
  } else if (hint?.filePath) {
    const cleanPath = hint.filePath.replace(/[\\/]/g, ".");
    qualified = normalizeTerm(`${cleanPath}:${term}`);
  } else {
    qualified = normalizeTerm(term);
  }
  return buildConceptKey("project", String(context.projectId), qualified);
}

// ---- Default registry implementation (in-memory cache over API) ----

interface LookupFn {
  (conceptKey: string): Promise<ResolvedConcept | null>;
}

interface CreateFn {
  (conceptKey: string, canonicalName: string, displayName: string, domain: string, conceptType: string, aliases: string[], difficulty: number): Promise<ResolvedConcept>;
}

interface SearchFn {
  (query: string): Promise<ResolvedConcept[]>;
}

export function createConceptResolver(
  lookup: LookupFn,
  create: CreateFn,
  search: SearchFn,
): ConceptResolver {
  const cache = new Map<string, ResolvedConcept>();

  async function resolve(
    term: string,
    context: ConceptResolutionContext,
  ): Promise<ResolvedConcept> {
    const normalized = normalizeTerm(term);
    if (!normalized) throw new Error(`Cannot resolve empty term`);

    // Try project symbol first if we have hints
    if (context.symbolHint) {
      const projectKey = projectConceptKey(term, context);
      const cached = cache.get(projectKey);
      if (cached) return cached;
      const existing = await lookup(projectKey);
      if (existing) { cache.set(projectKey, existing); return existing; }
      // Create project symbol concept
      const domain = context.domain || "project";
      const created = await create(projectKey, term, term, domain, "project_symbol", [], 0.5);
      cache.set(projectKey, created);
      return created;
    }

    // Try global tech term
    const domain = guessDomain(term, context);
    const globalKey = buildConceptKey("global", domain, normalized);

    const gc = cache.get(globalKey);
    if (gc) return gc;

    // Try lookup by key
    const existing = await lookup(globalKey);
    if (existing) { cache.set(globalKey, existing); return existing; }

    // Try search by name/alias
    const results = await search(normalized);
    if (results.length > 0) {
      const first = results[0];
      cache.set(globalKey, first);
      return first;
    }

    // Create new global concept (idempotent)
    const created = await create(globalKey, term, term, domain, "theory", [], estimateDifficulty(term));
    cache.set(globalKey, created);
    return created;
  }

  async function resolveBatch(
    terms: string[],
    context: ConceptResolutionContext,
  ): Promise<Map<string, ResolvedConcept>> {
    const result = new Map<string, ResolvedConcept>();
    const deduped = [...new Set(terms.map(normalizeTerm)).values()].filter(Boolean);
    await Promise.all(
      deduped.map(async (t) => {
        try {
          result.set(t, await resolve(t, context));
        } catch {
          // Skip failed resolutions — don't block rendering
        }
      }),
    );
    return result;
  }

  async function lookupFn(key: string): Promise<ResolvedConcept | null> {
    const cached = cache.get(key);
    if (cached) return cached;
    const existing = await lookup(key);
    if (existing) cache.set(key, existing);
    return existing ?? null;
  }

  return { resolve, resolveBatch, lookup: lookupFn };
}

function estimateDifficulty(term: string): number {
  const t = term.toLowerCase();
  // Very basic terms
  if (/^(variable|function|class|object|array|string|number|boolean|if|for|while)$/i.test(t)) return 0.1;
  // Common framework concepts
  if (/^(react|component|props|state|hook|effect|router|middleware|api|endpoint)$/i.test(t)) return 0.3;
  // Intermediate
  if (/^(closure|promise|async|await|generator|iterator|decorator|dependency.injection|orm)$/i.test(t)) return 0.5;
  // Advanced
  if (/^(mvcc|isolation.level|cap.theorem|distributed.consensus|raft|paxos|epoll|kqueue|io_uring)$/i.test(t)) return 0.8;
  return 0.5;
}
