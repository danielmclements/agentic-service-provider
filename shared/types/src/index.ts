export const ACTION_TYPES = [
  "RESET_PASSWORD",
  "UNLOCK_ACCOUNT",
  "ADD_TO_GROUP",
  "DISABLE_MFA"
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const POLICY_DECISIONS = ["AUTO_EXECUTE", "REQUIRES_APPROVAL", "BLOCK"] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const TICKET_STATUSES = [
  "RECEIVED",
  "TRIAGED",
  "WAITING_APPROVAL",
  "EXECUTING",
  "RESOLVED",
  "REJECTED",
  "BLOCKED"
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ACTION_STATUSES = [
  "PENDING",
  "WAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "BLOCKED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED"
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const EXECUTION_RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "WAITING_APPROVAL"] as const;
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];

export const IDENTITY_PROVIDERS = ["MOCK", "M365"] as const;
export type IdentityProviderKind = (typeof IDENTITY_PROVIDERS)[number];

export interface TicketIntakeRequest {
  tenant_id: string;
  user_email: string;
  message: string;
  metadata?: Record<string, unknown>;
  external_ticket_ref?: string;
}

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  allowedActions: ActionType[];
  approvalRules: Partial<Record<ActionType, PolicyDecision>>;
  identityProvider: IdentityProviderKind;
  model: {
    provider: "openai" | "heuristic";
    modelName: string;
  };
}

export interface TriageResult {
  category: "identity" | "helpdesk" | "unknown";
  intent: "reset_password" | "unlock_account" | "add_to_group" | "disable_mfa" | "unknown";
  confidence: number;
  recommendedAction: ActionType;
  rationale: string;
}

export interface ExecutionCommand {
  ticketId: string;
  tenantId: string;
  actionType: ActionType;
  userEmail: string;
  groupId?: string;
}

export interface ApprovalDecisionInput {
  decision: "approve" | "reject";
  reviewerIdentity: string;
  comment?: string;
}

export interface AuditEvent {
  tenantId: string;
  ticketId?: string;
  actionRequestId?: string;
  eventType: string;
  actor: "api" | "agent" | "system" | "operator";
  approvedBy?: string;
  payload: Record<string, unknown>;
}

export interface WorkflowTicketPayload {
  ticketId: string;
  tenantId: string;
}

export interface TicketView {
  id: string;
  tenantId: string;
  userEmail: string;
  message: string;
  status: TicketStatus;
  triage?: TriageResult | null;
  actionRequest?: {
    id: string;
    actionType: ActionType;
    riskLevel: RiskLevel;
    policyDecision: PolicyDecision;
    status: ActionStatus;
  } | null;
  approval?: {
    id: string;
    status: ApprovalStatus;
    reviewerIdentity?: string | null;
    reviewerComment?: string | null;
  } | null;
  executionRun?: {
    workflowId: string;
    status: ExecutionRunStatus;
    currentStep?: string | null;
  } | null;
}
