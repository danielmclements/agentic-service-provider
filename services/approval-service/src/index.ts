import { prisma } from "@asp/config";
import { ApprovalDecisionInput } from "@asp/types";

export class ApprovalService {
  async createPendingApproval(ticketId: string, actionRequestId: string) {
    return prisma.approval.create({
      data: {
        ticketId,
        actionRequestId,
        status: "PENDING"
      }
    });
  }

  async listApprovals(tenantId: string, status?: "PENDING" | "APPROVED" | "REJECTED") {
    return prisma.approval.findMany({
      where: {
        status,
        ticket: {
          tenantId
        }
      },
      include: {
        actionRequest: true,
        ticket: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async applyDecision(approvalId: string, tenantId: string, input: ApprovalDecisionInput, reviewerIdentity?: string) {
    const approval = await prisma.approval.findFirst({
      where: {
        id: approvalId,
        ticket: {
          tenantId
        }
      },
      include: {
        actionRequest: true,
        ticket: {
          include: {
            executionRuns: true
          }
        }
      }
    });

    if (!approval) {
      throw new Error("Approval not found");
    }

    const status = input.decision === "approve" ? "APPROVED" : "REJECTED";

    return prisma.$transaction(async (tx) => {
      const updatedApproval = await tx.approval.update({
        where: { id: approvalId },
        data: {
          status,
          reviewerIdentity,
          reviewerComment: input.comment,
          decidedAt: new Date()
        }
      });

      await tx.actionRequest.update({
        where: { id: approval.actionRequestId },
        data: {
          status: input.decision === "approve" ? "APPROVED" : "REJECTED"
        }
      });

      await tx.ticket.update({
        where: { id: approval.ticketId },
        data: {
          status: input.decision === "approve" ? "EXECUTING" : "REJECTED"
        }
      });

      return {
        approval: updatedApproval,
        workflowId: approval.ticket.executionRuns[0]?.workflowId ?? null
      };
    });
  }
}
