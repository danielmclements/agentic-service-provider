import { z } from "zod";
import {
  ACTION_TYPES,
  GLOBAL_ROLES,
  OPERATOR_PERMISSIONS,
  POLICY_DECISIONS,
  TENANT_ROLES,
  VERIFICATION_METHODS,
  VERIFICATION_STATUSES
} from "@asp/types";

export const ticketIntakeSchema = z.object({
  tenant_id: z.string().min(1),
  user_email: z.email(),
  message: z.string().min(5),
  metadata: z.record(z.string(), z.unknown()).optional(),
  external_ticket_ref: z.string().min(1).optional()
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional()
});

export const triageSchema = z.object({
  category: z.enum(["identity", "helpdesk", "unknown"]),
  intent: z.enum(["reset_password", "unlock_account", "add_to_group", "disable_mfa", "unknown"]),
  confidence: z.number().min(0).max(1),
  recommendedAction: z.enum(ACTION_TYPES),
  rationale: z.string().min(1)
});

export const approvalRuleSchema = z.partialRecord(z.enum(ACTION_TYPES), z.enum(POLICY_DECISIONS));

export const verificationDecisionSchema = z.object({
  status: z.enum(["VERIFIED", "FAILED", "EXPIRED", "BYPASSED"]),
  method: z.enum(VERIFICATION_METHODS).optional(),
  evidencePayload: z.record(z.string(), z.unknown()).optional()
});

export const userCreateSchema = z.object({
  auth0UserId: z.string().min(1).optional(),
  email: z.email(),
  displayName: z.string().min(1).optional(),
  globalRoles: z.array(z.enum(GLOBAL_ROLES)).optional(),
  initialMembership: z
    .object({
      tenantId: z.string().min(1).optional(),
      tenantRole: z.enum(TENANT_ROLES),
      permissionOverrides: z.array(z.enum(OPERATOR_PERMISSIONS)).optional(),
      active: z.boolean().optional()
    })
    .optional()
});

export const userUpdateSchema = z
  .object({
    email: z.email().optional(),
    displayName: z.string().min(1).optional(),
    active: z.boolean().optional(),
    globalRoles: z.array(z.enum(GLOBAL_ROLES)).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one user field must be provided"
  });

export const userMembershipCreateSchema = z.object({
  tenantId: z.string().min(1),
  tenantRole: z.enum(TENANT_ROLES),
  permissionOverrides: z.array(z.enum(OPERATOR_PERMISSIONS)).optional(),
  active: z.boolean().optional()
});

export const userMembershipUpdateSchema = z
  .object({
    tenantRole: z.enum(TENANT_ROLES).optional(),
    permissionOverrides: z.array(z.enum(OPERATOR_PERMISSIONS)).optional(),
    active: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one membership field must be provided"
  });
