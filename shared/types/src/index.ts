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
  "WAITING_VERIFICATION",
  "WAITING_APPROVAL",
  "EXECUTING",
  "RESOLVED",
  "REJECTED",
  "BLOCKED"
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ACTION_STATUSES = [
  "PENDING",
  "WAITING_VERIFICATION",
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

export const EXECUTION_RUN_STATUSES = ["PENDING", "RUNNING", "WAITING_VERIFICATION", "COMPLETED", "FAILED", "WAITING_APPROVAL"] as const;
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];

export const IDENTITY_PROVIDERS = ["MOCK", "M365"] as const;
export type IdentityProviderKind = (typeof IDENTITY_PROVIDERS)[number];

export const OPERATOR_PERMISSIONS = [
  "tickets:read",
  "tickets:submit",
  "approvals:read",
  "approvals:decide",
  "audit:read",
  "connectors:admin",
  "tenants:admin"
] as const;
export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export const OPERATOR_ROLES = [
  "tenant_viewer",
  "tenant_operator",
  "tenant_approver",
  "tenant_admin",
  "platform_admin"
] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const VERIFICATION_METHODS = ["PUSH", "WEBAUTHN", "SMS", "MANUAL_REVIEW"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "FAILED", "EXPIRED", "BYPASSED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

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
  verification: {
    requiredActions: ActionType[];
    primaryMethod: Extract<VerificationMethod, "PUSH" | "WEBAUTHN">;
    allowSmsFallback: boolean;
    requireManualReviewOnMissingFactor: boolean;
    challengeTtlMinutes: number;
  };
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
  comment?: string;
}

export interface ApprovalDecisionResult {
  approval: {
    id: string;
    status: ApprovalStatus;
    reviewerIdentity?: string | null;
    reviewerComment?: string | null;
    decidedAt?: string | Date | null;
  };
  workflowId: string | null;
  ticketId: string;
  actionRequestId: string;
}

export interface AuditEvent {
  tenantId: string;
  ticketId?: string;
  actionRequestId?: string;
  eventType: string;
  actor: "api" | "agent" | "system" | "operator";
  actorSubject?: string;
  actorOrgId?: string;
  actorSessionId?: string;
  actorDisplayName?: string;
  approvedBy?: string;
  payload: Record<string, unknown>;
}

export interface WorkflowTicketPayload {
  ticketId: string;
  tenantId: string;
}

export interface VerificationChallengeView {
  id: string;
  method: VerificationMethod;
  status: VerificationStatus;
  targetReference: string;
  issuedAt: string | Date;
  expiresAt: string | Date;
  completedAt?: string | Date | null;
  attemptCount: number;
}

export interface AuthenticatedSession {
  userId: string;
  email?: string;
  displayName?: string;
  sessionId: string;
  auth0OrganizationId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  roles: OperatorRole[];
  permissions: OperatorPermission[];
  authTime: number;
  amr: string[];
  mfaFreshUntil: number;
}

export interface ServicePrincipalContext {
  clientId: string;
  tenantId: string;
  permissions: OperatorPermission[];
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
  verification?: VerificationChallengeView | null;
  executionRun?: {
    workflowId: string;
    status: ExecutionRunStatus;
    currentStep?: string | null;
  } | null;
}
