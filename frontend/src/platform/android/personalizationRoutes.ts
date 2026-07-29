import type { AndroidRoute } from "./routeRegistry";

type Body = Record<string, unknown>;

export type AndroidPersonalizationHandlers = {
  listConcepts: (projectId: number, query?: string) => Promise<unknown>;
  createConcept: (projectId: number, body: Body) => Promise<unknown>;
  getMastery: (projectId: number, conceptIds: string[]) => Promise<unknown>;
  resolveTerms: (projectId: number, terms: unknown[]) => Promise<unknown>;
  getPreferences: (projectId: number) => Promise<unknown>;
  updatePreferences: (projectId: number, body: Body) => Promise<unknown>;
  applyAnswerFeedback: (projectId: number, body: Body) => Promise<unknown>;
  saveTermImpressions: (projectId: number, impressions: unknown[]) => Promise<unknown>;
  getTermDisplayProfiles: (projectId: number, conceptKeys: string[]) => Promise<unknown>;
  getKnowledgeStates: (projectId: number, conceptIds: string[]) => Promise<unknown>;
  appendEvidence: (projectId: number, body: Body) => Promise<unknown>;
  voidEvidence: (
    projectId: number,
    evidenceId: string,
    idempotencyKey: string,
    reason: string,
  ) => Promise<unknown>;
  rebuildProfile: (projectId: number) => Promise<unknown>;
  getPendingDiagnostic: (projectId: number) => Promise<unknown>;
  answerDiagnostic: (projectId: number, itemId: string, answer: unknown) => Promise<unknown>;
  dismissDiagnostic: (projectId: number, itemId: string) => Promise<unknown>;
  flagDiagnostic: (projectId: number, itemId: string) => Promise<unknown>;
  getTeachingTrial: (projectId: number, qaRecordId: number) => Promise<unknown>;
  submitTeachingFeedback: (
    projectId: number,
    qaRecordId: number,
    result: "successful" | "partially_successful" | "unsuccessful",
    idempotencyKey: string,
    reason: string,
  ) => Promise<unknown>;
  getProfile: (projectId: number) => Promise<unknown>;
  resetProfile: (projectId: number, scope: "project" | "global" | "all") => Promise<unknown>;
  voidInference: (projectId: number, inferenceId: string) => Promise<unknown>;
  answerSurvey: (projectId: number, surveyId: string, choice: string) => Promise<unknown>;
  dismissSurvey: (surveyId: string) => Promise<unknown>;
  getExplanation: (conceptId: string) => Promise<unknown>;
  markKnown: (
    projectId: number,
    conceptId: string,
    idempotencyKey: string,
    evidenceText?: string,
  ) => Promise<unknown>;
  markUnknown: (
    projectId: number,
    conceptId: string,
    idempotencyKey: string,
    evidenceText?: string,
  ) => Promise<unknown>;
  clearOverride: (projectId: number, conceptId: string, idempotencyKey: string) => Promise<unknown>;
  getEvents: (projectId: number, conceptId: string) => Promise<unknown>;
  voidEvent: (
    projectId: number,
    eventId: string,
    conceptId: string,
    idempotencyKey: string,
    reason?: string,
  ) => Promise<unknown>;
};

function id(match: RegExpMatchArray, index = 1): number {
  return Number(match[index]);
}

function decoded(match: RegExpMatchArray, index = 2): string {
  return decodeURIComponent(match[index]);
}

function requiredString(body: Body, key: string): string {
  const value = String(body[key] || "").trim();
  if (!value) throw new Error(`Missing personalization field: ${key}`);
  return value;
}

function feedbackResult(body: Body): "successful" | "partially_successful" | "unsuccessful" {
  const result = String(body.result);
  if (!["successful", "partially_successful", "unsuccessful"].includes(result)) {
    throw new Error("Unsupported teaching feedback result");
  }
  return result as "successful" | "partially_successful" | "unsuccessful";
}

export function createAndroidPersonalizationRoutes(
  handlers: AndroidPersonalizationHandlers,
): AndroidRoute[] {
  return [
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/concepts$/,
      handle: (match, request) => handlers.listConcepts(
        id(match),
        request.searchParams.get("query") || undefined,
      ),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/concepts$/,
      handle: (match, request) => handlers.createConcept(id(match), request.body),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/mastery$/,
      handle: (match, request) => handlers.getMastery(
        id(match),
        (request.searchParams.get("concept_ids") || "").split(",").filter(Boolean),
      ),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/resolve$/,
      handle: (match, request) => handlers.resolveTerms(
        id(match),
        Array.isArray(request.body.terms) ? request.body.terms : [],
      ),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/preferences$/,
      handle: (match) => handlers.getPreferences(id(match)),
    },
    {
      method: "PUT",
      pattern: /^\/projects\/(\d+)\/personalization\/preferences$/,
      handle: (match, request) => handlers.updatePreferences(id(match), request.body),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/answer-feedback$/,
      handle: (match, request) => handlers.applyAnswerFeedback(id(match), request.body),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/term-impressions\/batch$/,
      handle: (match, request) => handlers.saveTermImpressions(
        id(match),
        Array.isArray(request.body.impressions) ? request.body.impressions : [],
      ),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/term-display-profiles$/,
      handle: (match, request) => handlers.getTermDisplayProfiles(
        id(match),
        Array.isArray(request.body.concept_keys)
          ? request.body.concept_keys.map(String).slice(0, 200)
          : [],
      ),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/knowledge-state$/,
      handle: (match, request) => handlers.getKnowledgeStates(
        id(match),
        (request.searchParams.get("concept_ids") || "").split(",").filter(Boolean),
      ),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/evidence$/,
      handle: (match, request) => handlers.appendEvidence(id(match), request.body),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/evidence\/([^/]+)\/void$/,
      handle: (match, request) => handlers.voidEvidence(
        id(match),
        decoded(match),
        String(request.body.idempotencyKey || `void-v2:${decoded(match)}`),
        String(request.body.reason || ""),
      ),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/rebuild$/,
      handle: (match) => handlers.rebuildProfile(id(match)),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/diagnostics\/pending$/,
      handle: (match) => handlers.getPendingDiagnostic(id(match)),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/diagnostics\/([^/]+)\/answer$/,
      handle: (match, request) => handlers.answerDiagnostic(id(match), decoded(match), request.body.answer),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/diagnostics\/([^/]+)\/dismiss$/,
      handle: (match) => handlers.dismissDiagnostic(id(match), decoded(match)),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/diagnostics\/([^/]+)\/flag$/,
      handle: (match) => handlers.flagDiagnostic(id(match), decoded(match)),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/teaching\/(\d+)$/,
      handle: (match) => handlers.getTeachingTrial(id(match), id(match, 2)),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/teaching\/(\d+)\/feedback$/,
      handle: (match, request) => handlers.submitTeachingFeedback(
        id(match),
        id(match, 2),
        feedbackResult(request.body),
        String(
          request.body.idempotency_key
          || `teaching-feedback:${match[2]}:${request.body.result}:${Date.now()}`
        ),
        String(request.body.reason || ""),
      ),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/profile$/,
      handle: (match) => handlers.getProfile(id(match)),
    },
    {
      method: "DELETE",
      pattern: /^\/projects\/(\d+)\/personalization\/profile$/,
      handle: (match, request) => {
        const scope = request.searchParams.get("scope");
        return handlers.resetProfile(
          id(match),
          scope === "all" ? "all" : scope === "global" ? "global" : "project",
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/inferences\/([^/]+)\/void$/,
      handle: (match) => handlers.voidInference(id(match), decoded(match)),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/surveys\/([^/]+)\/answer$/,
      handle: (match, request) => handlers.answerSurvey(
        id(match),
        decoded(match),
        String(request.body.choice || ""),
      ),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/surveys\/([^/]+)\/dismiss$/,
      handle: (match) => handlers.dismissSurvey(decoded(match)),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/concepts\/([^/]+)\/explanation$/,
      handle: (match) => handlers.getExplanation(decoded(match)),
    },
    ...(["mark-known", "mark-unknown"] as const).map((action): AndroidRoute => ({
      method: "POST",
      pattern: new RegExp(`^/projects/(\\d+)/personalization/${action}$`),
      handle: (match, request) => {
        const conceptId = requiredString(request.body, "conceptId");
        const idempotencyKey = requiredString(request.body, "idempotencyKey");
        const evidenceText = typeof request.body.evidenceText === "string"
          ? request.body.evidenceText
          : undefined;
        return action === "mark-known"
          ? handlers.markKnown(id(match), conceptId, idempotencyKey, evidenceText)
          : handlers.markUnknown(id(match), conceptId, idempotencyKey, evidenceText);
      },
    })),
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/clear-override$/,
      handle: (match, request) => handlers.clearOverride(
        id(match),
        requiredString(request.body, "conceptId"),
        requiredString(request.body, "idempotencyKey"),
      ),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/personalization\/events\/([^/]+)$/,
      handle: (match) => handlers.getEvents(id(match), decoded(match)),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/personalization\/events\/([^/]+)\/void$/,
      handle: (match, request) => handlers.voidEvent(
        id(match),
        decoded(match),
        String(request.body.conceptId || ""),
        String(request.body.idempotencyKey || `void:${decoded(match)}:${Date.now()}`),
        typeof request.body.reason === "string" ? request.body.reason : undefined,
      ),
    },
  ];
}
