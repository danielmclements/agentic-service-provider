import express from "express";
import rateLimit from "express-rate-limit";
import { prisma, env } from "@asp/config";
import { AuditLogService } from "@asp/audit-log";
import { ApprovalService } from "@asp/approval-service";
import { httpLogger } from "@asp/logger";
import { startTicketWorkflow, signalApprovalDecision } from "@asp/orchestration";
import { TenantContextService } from "@asp/tenant-context";
import { TicketIntakeService } from "@asp/ticket-intake";
import { approvalDecisionSchema, ticketIntakeSchema } from "@asp/validation";

const ticketIntakeService = new TicketIntakeService();
const tenantContextService = new TenantContextService();
const approvalService = new ApprovalService();
const auditLogService = new AuditLogService();

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.header("x-api-key") !== env.API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function requireOperatorKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.header("x-operator-key") !== env.OPERATOR_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function requireTenantId(req: express.Request, res: express.Response, next: express.NextFunction) {
  const tenantId = req.header("x-tenant-id") ?? req.body?.tenant_id ?? req.query.tenantId;

  if (!tenantId || typeof tenantId !== "string") {
    res.status(400).json({ error: "tenant_id is required" });
    return;
  }

  req.tenantId = tenantId;
  next();
}

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(httpLogger);
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 60
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/tickets", requireApiKey, requireTenantId, async (req, res) => {
    try {
      const input = ticketIntakeSchema.parse(req.body);
      await tenantContextService.getTenantContext(input.tenant_id);

      const idempotencyKey = req.header("idempotency-key") ?? undefined;
      const { ticket, executionRun, deduplicated } = await ticketIntakeService.createTicket(input, idempotencyKey);

      if (deduplicated && executionRun) {
        res.status(200).json({
          ticketId: ticket.id,
          workflowId: executionRun.workflowId,
          status: ticket.status,
          deduplicated: true
        });
        return;
      }

      const workflowHandle = await startTicketWorkflow({
        ticketId: ticket.id,
        tenantId: ticket.tenantId
      });

      const run = await prisma.executionRun.create({
        data: {
          ticketId: ticket.id,
          workflowId: workflowHandle.workflowId,
          status: "PENDING",
          currentStep: "QUEUED"
        }
      });

      await auditLogService.log({
        tenantId: ticket.tenantId,
        ticketId: ticket.id,
        eventType: "TICKET_RECEIVED",
        actor: "api",
        payload: {
          userEmail: ticket.userEmail,
          externalTicketRef: ticket.externalTicketRef ?? null
        }
      });

      res.status(202).json({
        ticketId: ticket.id,
        workflowId: run.workflowId,
        status: ticket.status
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to create ticket"
      });
    }
  });

  app.get("/api/tickets", requireApiKey, requireTenantId, async (req, res) => {
    const tickets = await ticketIntakeService.listTickets(req.tenantId!);
    res.json({ tickets });
  });

  app.get("/api/tickets/:id", requireApiKey, requireTenantId, async (req, res) => {
    const ticketId = String(req.params.id);
    const ticket = await ticketIntakeService.getTicketView(ticketId, req.tenantId!);

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json({ ticket });
  });

  app.get("/api/approvals", requireOperatorKey, requireTenantId, async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED") : undefined;
    const approvals = await approvalService.listApprovals(req.tenantId!, status);
    res.json({ approvals });
  });

  app.post("/api/approvals/:id/decision", requireOperatorKey, requireTenantId, async (req, res) => {
    try {
      const approvalId = String(req.params.id);
      const input = approvalDecisionSchema.parse(req.body);
      const result = await approvalService.applyDecision(approvalId, req.tenantId!, input);

      await auditLogService.log({
        tenantId: req.tenantId!,
        ticketId: undefined,
        actionRequestId: undefined,
        eventType: "APPROVAL_DECIDED",
        actor: "operator",
        approvedBy: input.reviewerIdentity,
        payload: {
          approvalId: req.params.id,
          decision: input.decision,
          comment: input.comment ?? null
        }
      });

      if (result.workflowId) {
        await signalApprovalDecision(result.workflowId, {
          approved: input.decision === "approve",
          reviewerIdentity: input.reviewerIdentity,
          comment: input.comment
        });
      }

      res.json({ approval: result.approval });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to apply decision"
      });
    }
  });

  app.get("/api/audit/:ticketId", requireApiKey, requireTenantId, async (req, res) => {
    const ticketId = String(req.params.ticketId);
    const events = await auditLogService.getTicketAuditTrail(ticketId, req.tenantId!);
    res.json({ events });
  });

  return app;
}
