import { describe, expect, it } from "vitest";
import { resetGenerationScope } from "../App";

describe("resetGenerationScope", () => {
  it("clears selected files and returns to the whole project for a repository", () => {
    const next = resetGenerationScope(false, "files");
    expect(next).toEqual({ scopeType: "full_project", selectedScopeFiles: [] });
  });

  it("clears selected files when already on the whole-project scope", () => {
    const next = resetGenerationScope(false, "full_project");
    expect(next).toEqual({ scopeType: "full_project", selectedScopeFiles: [] });
  });

  it("keeps the scope for learning plans but still clears files", () => {
    const next = resetGenerationScope(true, "learning_plan");
    expect(next).toEqual({ scopeType: "learning_plan", selectedScopeFiles: [] });
  });
});
