import { HelpdeskTriageAgent } from "@asp/helpdesk-triage";
import { TenantContext } from "@asp/types";

const tenantContext: TenantContext = {
  tenantId: "eval",
  tenantName: "Eval Tenant",
  allowedActions: ["RESET_PASSWORD", "UNLOCK_ACCOUNT", "ADD_TO_GROUP"],
  approvalRules: {
    ADD_TO_GROUP: "REQUIRES_APPROVAL",
    DISABLE_MFA: "BLOCK"
  },
  identityProvider: "MOCK",
  verification: {
    requiredActions: ["RESET_PASSWORD", "ADD_TO_GROUP", "DISABLE_MFA"],
    primaryMethod: "PUSH",
    allowSmsFallback: false,
    requireManualReviewOnMissingFactor: true,
    challengeTtlMinutes: 10
  },
  model: {
    provider: "heuristic",
    modelName: "eval-heuristic"
  }
};

export const evalDataset = [
  { message: "I am locked out of my account", expectedAction: "UNLOCK_ACCOUNT" },
  { message: "Please reset my password", expectedAction: "RESET_PASSWORD" },
  { message: "Can you add me to the finance group", expectedAction: "ADD_TO_GROUP" },
  { message: "Disable my MFA so I can log in", expectedAction: "DISABLE_MFA" },
  { message: "Something is wrong with my login", expectedAction: "ADD_TO_GROUP" }
];

export async function runTriageEval() {
  const agent = new HelpdeskTriageAgent();
  const outcomes = [];

  for (const sample of evalDataset) {
    const triage = await agent.triage(sample.message, tenantContext);
    outcomes.push({
      message: sample.message,
      expectedAction: sample.expectedAction,
      actualAction: triage.recommendedAction,
      success: triage.recommendedAction === sample.expectedAction
    });
  }

  const accuracy = outcomes.filter((outcome) => outcome.success).length / outcomes.length;

  return {
    accuracy,
    outcomes
  };
}
