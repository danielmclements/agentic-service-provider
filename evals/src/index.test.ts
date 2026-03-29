import { describe, expect, it } from "vitest";
import { runTriageEval } from "./index";

describe("triage eval", () => {
  it("reports eval accuracy for the seeded dataset", async () => {
    const result = await runTriageEval();

    expect(result.accuracy).toBeGreaterThan(0.7);
    expect(result.outcomes).toHaveLength(5);
  });
});
