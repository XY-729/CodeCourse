import type { PersonalizationConcept } from "../api/client";

export type ConceptTreeNode = {
  id: string;
  name: string;
  concept: PersonalizationConcept | null;
  children: ConceptTreeNode[];
  descendantCount: number;
};

export function isReadableConceptLabel(name: string): boolean {
  return Boolean(name.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff]/u.test(name);
}

/** Build a display tree from persisted parents; never infer taxonomy from words. */
export function buildConceptTree(concepts: readonly PersonalizationConcept[]): ConceptTreeNode[] {
  const available = concepts.filter((concept) => concept.conceptType !== "archived"
    && isReadableConceptLabel(concept.displayName));
  const byId = new Map(available.map((concept) => [concept.id, concept]));
  const children = new Map<string, PersonalizationConcept[]>();
  const roots: PersonalizationConcept[] = [];
  const pending: PersonalizationConcept[] = [];
  for (const concept of available) {
    if (concept.parent_id && byId.has(concept.parent_id) && concept.parent_id !== concept.id) {
      children.set(concept.parent_id, [...(children.get(concept.parent_id) ?? []), concept]);
    } else if (concept.parent_id || concept.placement_status === "pending"
      || concept.placement_status === "legacy" || concept.parent_id === concept.id) {
      pending.push(concept);
    } else {
      roots.push(concept);
    }
  }
  const order = (left: PersonalizationConcept, right: PersonalizationConcept) =>
    left.displayName.localeCompare(right.displayName, "zh-CN");
  const seen = new Set<string>();
  const visit = (concept: PersonalizationConcept): ConceptTreeNode | null => {
    if (seen.has(concept.id)) return null;
    seen.add(concept.id);
    const nested = (children.get(concept.id) ?? []).sort(order)
      .map(visit).filter((node): node is ConceptTreeNode => node !== null);
    return { id: concept.id, name: concept.displayName, concept, children: nested,
      descendantCount: nested.reduce((total, child) => total + 1 + child.descendantCount, 0) };
  };
  const result = roots.sort(order).map(visit).filter((node): node is ConceptTreeNode => node !== null);
  const unresolved = pending.sort(order).map(visit).filter((node): node is ConceptTreeNode => node !== null);
  // Cycles and inaccessible ancestors remain inspectable under one folder.
  for (const concept of available.sort(order)) {
    if (!seen.has(concept.id)) {
      const node = visit(concept);
      if (node) unresolved.push(node);
    }
  }
  if (unresolved.length) result.push({
    id: "concept-tree:unclassified", name: "待归类", concept: null, children: unresolved,
    descendantCount: unresolved.reduce((total, child) => total + 1 + child.descendantCount, 0),
  });
  return result;
}

export function filterConceptTree(nodes: readonly ConceptTreeNode[], query: string): ConceptTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...nodes];
  return nodes.flatMap((node) => {
    if ([node.name, ...(node.concept?.aliases ?? [])].some((name) => name.toLocaleLowerCase().includes(normalized))) return [node];
    const children = filterConceptTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function conceptBranchIds(nodes: readonly ConceptTreeNode[]): string[] {
  return nodes.flatMap((node) => node.children.length ? [node.id, ...conceptBranchIds(node.children)] : []);
}
