import { ActionType, PolicyDecision, RiskLevel, TenantContext } from "@asp/types";

const DEFAULT_RISK: Record<ActionType, RiskLevel> = {
  RESET_PASSWORD: "LOW",
  UNLOCK_ACCOUNT: "LOW",
  ADD_TO_GROUP: "MEDIUM",
  DISABLE_MFA: "HIGH"
};

export class PolicyEngineService {
  evaluate(actionType: ActionType, tenantContext: TenantContext): { decision: PolicyDecision; riskLevel: RiskLevel } {
    const riskLevel = DEFAULT_RISK[actionType];
    const tenantOverride = tenantContext.approvalRules[actionType];

    if (!tenantContext.allowedActions.includes(actionType)) {
      return { decision: "BLOCK", riskLevel };
    }

    if (tenantOverride) {
      return { decision: tenantOverride, riskLevel };
    }

    if (riskLevel === "LOW") {
      return { decision: "AUTO_EXECUTE", riskLevel };
    }

    if (riskLevel === "MEDIUM") {
      return { decision: "REQUIRES_APPROVAL", riskLevel };
    }

    return { decision: "BLOCK", riskLevel };
  }
}
