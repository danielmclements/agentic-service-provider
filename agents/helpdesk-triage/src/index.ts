import OpenAI from "openai";
import { env } from "@asp/config";
import { TenantContext, TriageResult } from "@asp/types";
import { triageSchema } from "@asp/validation";

const heuristicMap: Array<{ match: RegExp; result: TriageResult }> = [
  {
    match: /locked|unlock/i,
    result: {
      category: "identity",
      intent: "unlock_account",
      confidence: 0.93,
      recommendedAction: "UNLOCK_ACCOUNT",
      rationale: "Request indicates account lockout or unlock issue."
    }
  },
  {
    match: /password|reset/i,
    result: {
      category: "identity",
      intent: "reset_password",
      confidence: 0.91,
      recommendedAction: "RESET_PASSWORD",
      rationale: "Request indicates password reset need."
    }
  },
  {
    match: /group|access|membership/i,
    result: {
      category: "identity",
      intent: "add_to_group",
      confidence: 0.84,
      recommendedAction: "ADD_TO_GROUP",
      rationale: "Request indicates access or group membership change."
    }
  },
  {
    match: /disable mfa|turn off mfa/i,
    result: {
      category: "identity",
      intent: "disable_mfa",
      confidence: 0.96,
      recommendedAction: "DISABLE_MFA",
      rationale: "Request indicates MFA disablement."
    }
  }
];

function fallbackTriage(message: string): TriageResult {
  const match = heuristicMap.find((candidate) => candidate.match.test(message));
  return (
    match?.result ?? {
      category: "unknown",
      intent: "unknown",
      confidence: 0.25,
      recommendedAction: "ADD_TO_GROUP",
      rationale: "The request is ambiguous and should be routed conservatively."
    }
  );
}

export class HelpdeskTriageAgent {
  private readonly client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

  async triage(message: string, tenantContext: TenantContext): Promise<TriageResult> {
    if (!this.client || tenantContext.model.provider === "heuristic") {
      return fallbackTriage(message);
    }

    const response = await this.client.responses.create({
      model: tenantContext.model.modelName || env.OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Classify helpdesk identity requests into a strict JSON object with category, intent, confidence, recommendedAction, and rationale. Only choose recommendedAction from RESET_PASSWORD, UNLOCK_ACCOUNT, ADD_TO_GROUP, DISABLE_MFA."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                message,
                allowedActions: tenantContext.allowedActions,
                approvalRules: tenantContext.approvalRules
              })
            }
          ]
        }
      ]
    });

    const payload = response.output_text;
    return triageSchema.parse(JSON.parse(payload));
  }
}
