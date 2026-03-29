import { Prisma } from "@prisma/client";
import { prisma } from "@asp/config";
import { AuditLogService } from "@asp/audit-log";
import { HelpdeskTriageAgent } from "@asp/helpdesk-triage";
import { IdentityOpsAgent } from "@asp/identity-ops";
import { PolicyEngineService } from "@asp/policy-engine";
import { TenantContextService } from "@asp/tenant-context";
import { ExecutionCommand } from "@asp/types";

const tenantContextService = new TenantContextService();
const triageAgent = new HelpdeskTriageAgent();
const policyEngine = new PolicyEngineService();
const identityOpsAgent = new IdentityOpsAgent();
const auditLog = new AuditLogService();

function buildExecutionCommand(ticketId: string, tenantId: string, userEmail: string, actionType: ExecutionCommand["actionType"]): ExecutionCommand {
  return {
    ticketId,
    tenantId,
    userEmail,
    actionType
  };
}

export async function triageAndEvaluatePolicy(ticketId: string, tenantId: string) {
  const tenantContext = await tenantContextService.getTenantContext(tenantId);
  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { id: ticketId, tenantId }
  });

  const triage = await triageAgent.triage(ticket.normalizedMessage, tenantContext);
  const { decision, riskLevel } = policyEngine.evaluate(triage.recommendedAction, tenantContext);
  const command = buildExecutionCommand(ticket.id, ticket.tenantId, ticket.userEmail, triage.recommendedAction);

  const actionRequest = await prisma.actionRequest.create({
    data: {
      ticketId: ticket.id,
      actionType: triage.recommendedAction,
      riskLevel,
      policyDecision: decision,
      status: decision === "AUTO_EXECUTE" ? "PENDING" : decision === "REQUIRES_APPROVAL" ? "WAITING_APPROVAL" : "BLOCKED",
      inputPayload: command as unknown as Prisma.InputJsonValue
    }
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      status: decision === "BLOCK" ? "BLOCKED" : decision === "REQUIRES_APPROVAL" ? "WAITING_APPROVAL" : "TRIAGED",
      triageCategory: triage.category,
      triageIntent: triage.intent,
      triageConfidence: triage.confidence,
      triageAction: triage.recommendedAction,
      triageRationale: triage.rationale
    }
  });

  await auditLog.log({
    tenantId,
    ticketId,
    actionRequestId: actionRequest.id,
    eventType: "TRIAGE_COMPLETED",
    actor: "agent",
    payload: triage as unknown as Record<string, unknown>
  });

  await auditLog.log({
    tenantId,
    ticketId,
    actionRequestId: actionRequest.id,
    eventType: "POLICY_EVALUATED",
    actor: "system",
    payload: {
      decision,
      riskLevel
    }
  });

  return {
    actionRequestId: actionRequest.id,
    decision,
    riskLevel,
    command,
    identityProvider: tenantContext.identityProvider
  };
}

export async function markExecutionRun(ticketId: string, status: "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED", currentStep: string, lastError?: string) {
  await prisma.executionRun.updateMany({
    where: { ticketId },
    data: {
      status,
      currentStep,
      lastError,
      completedAt: status === "COMPLETED" || status === "FAILED" ? new Date() : null
    }
  });
}

export async function createApproval(ticketId: string, actionRequestId: string) {
  const approval = await prisma.approval.create({
    data: {
      ticketId,
      actionRequestId
    }
  });

  await auditLog.log({
    tenantId: (await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).tenantId,
    ticketId,
    actionRequestId,
    eventType: "APPROVAL_REQUESTED",
    actor: "system",
    payload: {
      approvalId: approval.id
    }
  });

  return approval;
}

export async function executeAction(ticketId: string, tenantId: string, actionRequestId: string) {
  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { id: ticketId, tenantId }
  });
  const actionRequest = await prisma.actionRequest.findUniqueOrThrow({
    where: { id: actionRequestId }
  });
  const tenantContext = await tenantContextService.getTenantContext(tenantId);
  const command = actionRequest.inputPayload as unknown as ExecutionCommand;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "EXECUTING" }
  });

  await prisma.actionRequest.update({
    where: { id: actionRequestId },
    data: { status: "EXECUTING" }
  });

  await auditLog.log({
    tenantId,
    ticketId,
    actionRequestId,
    eventType: "EXECUTION_STARTED",
    actor: "system",
    payload: { actionType: actionRequest.actionType }
  });

  const result = await identityOpsAgent.execute(tenantContext.identityProvider, command);

  await prisma.actionRequest.update({
        where: { id: actionRequestId },
        data: {
          status: "SUCCEEDED",
          outputPayload: result as Prisma.InputJsonValue
        }
      });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "RESOLVED" }
  });

  await auditLog.log({
    tenantId,
    ticketId,
    actionRequestId,
    eventType: "EXECUTION_COMPLETED",
    actor: "system",
    payload: result as Record<string, unknown>
  });

  return result;
}

export async function rejectAction(ticketId: string, tenantId: string, actionRequestId: string, reviewerIdentity: string, comment?: string) {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "REJECTED" }
  });

  await prisma.actionRequest.update({
    where: { id: actionRequestId },
    data: {
      status: "REJECTED",
      errorMessage: comment
    }
  });

  await auditLog.log({
    tenantId,
    ticketId,
    actionRequestId,
    eventType: "APPROVAL_REJECTED",
    actor: "operator",
    approvedBy: reviewerIdentity,
    payload: { comment: comment ?? null }
  });
}

export async function blockAction(ticketId: string, tenantId: string, actionRequestId: string) {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "BLOCKED" }
  });

  await prisma.actionRequest.update({
    where: { id: actionRequestId },
    data: { status: "BLOCKED" }
  });

  await auditLog.log({
    tenantId,
    ticketId,
    actionRequestId,
    eventType: "ACTION_BLOCKED",
    actor: "system",
    payload: {}
  });
}
