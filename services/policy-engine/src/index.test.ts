import { describe, expect, it } from "vitest";
import { PolicyEngineService } from "./index";
import { TenantContext } from "@asp/types";

const service = new PolicyEngineService();
const verification: TenantContext["verification"] = {
  requiredActions: ["RESET_PASSWORD", "ADD_TO_GROUP", "DISABLE_MFA"],
  primaryMethod: "PUSH",
  allowSmsFallback: false,
  requireManualReviewOnMissingFactor: true,
  challengeTtlMinutes: 10
};

describe("PolicyEngineService", () => {
  it("auto-executes low-risk allowed actions", () => {
    const result = service.evaluate("RESET_PASSWORD", {
      tenantId: "tenant",
      tenantName: "Tenant",
      allowedActions: ["RESET_PASSWORD", "UNLOCK_ACCOUNT", "ADD_TO_GROUP"],
      approvalRules: {},
      identityProvider: "MOCK",
      verification,
      model: {
        provider: "heuristic",
        modelName: "local"
      }
    });

    expect(result).toEqual({
      decision: "AUTO_EXECUTE",
      riskLevel: "LOW"
    });
  });

  it("blocks actions not allowed by tenant policy", () => {
    const result = service.evaluate("DISABLE_MFA", {
      tenantId: "tenant",
      tenantName: "Tenant",
      allowedActions: ["RESET_PASSWORD"],
      approvalRules: {},
      identityProvider: "MOCK",
      verification,
      model: {
        provider: "heuristic",
        modelName: "local"
      }
    });

    expect(result.decision).toBe("BLOCK");
  });
});
