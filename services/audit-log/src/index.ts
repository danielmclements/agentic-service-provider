import { Prisma } from "@prisma/client";
import { prisma } from "@asp/config";
import { AuditEvent } from "@asp/types";

function redact(payload: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(payload, (key, value) => {
      if (["password", "token", "secret", "apiKey"].includes(key)) {
        return "[REDACTED]";
      }

      return value;
    })
  ) as Record<string, unknown>;
}

export class AuditLogService {
  async log(event: AuditEvent) {
    return prisma.auditLog.create({
      data: {
        tenantId: event.tenantId,
        ticketId: event.ticketId,
        actionRequestId: event.actionRequestId,
        eventType: event.eventType,
        actor: event.actor,
        approvedBy: event.approvedBy,
        payload: redact(event.payload) as Prisma.InputJsonValue
      }
    });
  }

  async getTicketAuditTrail(ticketId: string, tenantId: string) {
    return prisma.auditLog.findMany({
      where: { ticketId, tenantId },
      orderBy: { createdAt: "asc" }
    });
  }
}
