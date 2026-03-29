import { describe, expect, it } from "vitest";
import { HelpdeskTriageAgent } from "./index";
import { TenantContext } from "@asp/types";

const verification: TenantContext["verification"] = {
  requiredActions: ["RESET_PASSWORD", "ADD_TO_GROUP", "DISABLE_MFA"],
  primaryMethod: "PUSH",
  allowSmsFallback: false,
  requireManualReviewOnMissingFactor: true,
  challengeTtlMinutes: 10
};

describe("HelpdeskTriageAgent", () => {
  it("classifies lockout requests with heuristic fallback", async () => {
    const agent = new HelpdeskTriageAgent();
    const result = await agent.triage("I am locked out of my account", {
      tenantId: "tenant",
      tenantName: "Tenant",
      allowedActions: ["RESET_PASSWORD", "UNLOCK_ACCOUNT", "ADD_TO_GROUP"],
      approvalRules: {
        ADD_TO_GROUP: "REQUIRES_APPROVAL"
      },
      identityProvider: "MOCK",
      verification,
      model: {
        provider: "heuristic",
        modelName: "local"
      }
    });

    expect(result.recommendedAction).toBe("UNLOCK_ACCOUNT");
    expect(result.intent).toBe("unlock_account");
  });
});
