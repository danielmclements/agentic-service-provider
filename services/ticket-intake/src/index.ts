import { Prisma } from "@prisma/client";
import { prisma } from "@asp/config";
import { TicketIntakeRequest } from "@asp/types";

function normalizeMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

export class TicketIntakeService {
  async createTicket(input: TicketIntakeRequest, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await prisma.ticket.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: input.tenant_id,
            idempotencyKey
          }
        },
        include: {
          executionRuns: true
        }
      });

      if (existing) {
        return {
          ticket: existing,
          executionRun: existing.executionRuns[0] ?? null,
          deduplicated: true
        };
      }
    }

    const ticket = await prisma.ticket.create({
      data: {
        tenantId: input.tenant_id,
        userEmail: input.user_email,
        message: input.message,
        normalizedMessage: normalizeMessage(input.message),
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        externalTicketRef: input.external_ticket_ref,
        idempotencyKey,
        status: "RECEIVED"
      }
    });

    return {
      ticket,
      executionRun: null,
      deduplicated: false
    };
  }

  async listTickets(tenantId: string) {
    return prisma.ticket.findMany({
      where: { tenantId },
      include: {
        actionRequests: true,
        approvals: true,
        executionRuns: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async getTicketView(ticketId: string, tenantId: string) {
    return prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      include: {
        actionRequests: {
          include: {
            approval: true
          }
        },
        executionRuns: true
      }
    });
  }
}
