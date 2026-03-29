import { prisma } from "@asp/config";

const MANUAL_MINUTES_BY_ACTION: Record<string, number> = {
  RESET_PASSWORD: 8,
  UNLOCK_ACCOUNT: 6,
  ADD_TO_GROUP: 12,
  DISABLE_MFA: 15
};

const PLATFORM_TOUCH_MINUTES_BY_DECISION: Record<string, number> = {
  AUTO_EXECUTE: 0.5,
  REQUIRES_APPROVAL: 3,
  BLOCK: 1.5
};

function toPercent(numerator: number, denominator: number) {
  if (denominator === 0) {
    return 0;
  }

  return Number(((numerator / denominator) * 100).toFixed(1));
}

function toAverage(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(1));
}

function toSum(values: number[]) {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(1));
}

export class OperatorInsightsService {
  async getOperatorSummary(tenantId: string) {
    const [tickets, approvals] = await Promise.all([
      prisma.ticket.findMany({
        where: { tenantId },
        include: {
          actionRequests: {
            include: {
              approval: true
            }
          },
          executionRuns: true
        },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.approval.findMany({
        where: {
          status: "PENDING",
          ticket: {
            tenantId
          }
        },
        include: {
          ticket: true,
          actionRequest: true
        },
        orderBy: { createdAt: "asc" },
        take: 10
      })
    ]);

    const totals = tickets.reduce(
      (acc, ticket) => {
        acc.tickets += 1;

        if (ticket.status === "RESOLVED") {
          acc.resolved += 1;
        }

        if (ticket.status === "WAITING_APPROVAL") {
          acc.waitingApproval += 1;
        }

        if (ticket.status === "BLOCKED") {
          acc.blocked += 1;
        }

        if (ticket.status === "REJECTED") {
          acc.rejected += 1;
        }

        return acc;
      },
      {
        tickets: 0,
        resolved: 0,
        waitingApproval: 0,
        blocked: 0,
        rejected: 0
      }
    );

    return {
      totals: {
        ...totals,
        pendingApprovals: approvals.length
      },
      pendingApprovals: approvals.map((approval) => ({
        id: approval.id,
        createdAt: approval.createdAt,
        ticketId: approval.ticketId,
        userEmail: approval.ticket.userEmail,
        actionType: approval.actionRequest.actionType,
        riskLevel: approval.actionRequest.riskLevel,
        ticketStatus: approval.ticket.status,
        queueAgeSeconds: Math.round((Date.now() - approval.createdAt.getTime()) / 1000),
        recommendedAction: approval.ticket.triageAction,
        triageConfidence: approval.ticket.triageConfidence,
        triageRationale: approval.ticket.triageRationale,
        message: approval.ticket.message
      })),
      recentTickets: tickets.map((ticket) => {
        const actionRequest = ticket.actionRequests[0] ?? null;
        const approval = actionRequest?.approval ?? null;
        const executionRun = ticket.executionRuns[0] ?? null;

        return {
          id: ticket.id,
          createdAt: ticket.createdAt,
          userEmail: ticket.userEmail,
          status: ticket.status,
          triageIntent: ticket.triageIntent,
          triageAction: ticket.triageAction,
          triageConfidence: ticket.triageConfidence,
          triageRationale: ticket.triageRationale,
          riskLevel: actionRequest?.riskLevel ?? null,
          actionStatus: actionRequest?.status ?? null,
          policyDecision: actionRequest?.policyDecision ?? null,
          approvalStatus: approval?.status ?? null,
          workflowStatus: executionRun?.status ?? null,
          workflowStep: executionRun?.currentStep ?? null,
          updatedAt: ticket.updatedAt,
          message: ticket.message
        };
      })
    };
  }

  async getBusinessMetrics(tenantId: string) {
    const [tickets, actionRequests, approvals] = await Promise.all([
      prisma.ticket.findMany({
        where: { tenantId },
        include: {
          executionRuns: true
        }
      }),
      prisma.actionRequest.findMany({
        where: {
          ticket: {
            tenantId
          }
        }
      }),
      prisma.approval.findMany({
        where: {
          ticket: {
            tenantId
          }
        }
      })
    ]);

    const totalTickets = tickets.length;
    const totalActions = actionRequests.length;
    const autoExecuted = actionRequests.filter((request) => request.policyDecision === "AUTO_EXECUTE").length;
    const approvalGated = actionRequests.filter((request) => request.policyDecision === "REQUIRES_APPROVAL").length;
    const blocked = actionRequests.filter((request) => request.policyDecision === "BLOCK").length;
    const succeeded = actionRequests.filter((request) => request.status === "SUCCEEDED").length;
    const failed = actionRequests.filter((request) => request.status === "FAILED").length;

    const cycleTimes = tickets
      .flatMap((ticket) =>
        ticket.executionRuns
          .filter((run) => run.completedAt)
          .map((run) => (run.completedAt!.getTime() - ticket.createdAt.getTime()) / 1000)
      );

    const ticketsByAction = actionRequests.reduce<Record<string, number>>((acc, request) => {
      acc[request.actionType] = (acc[request.actionType] ?? 0) + 1;
      return acc;
    }, {});

    const approvalsByStatus = approvals.reduce<Record<string, number>>((acc, approval) => {
      acc[approval.status] = (acc[approval.status] ?? 0) + 1;
      return acc;
    }, {});

    const decidedApprovalLatencies = approvals
      .filter((approval) => approval.decidedAt)
      .map((approval) => (approval.decidedAt!.getTime() - approval.createdAt.getTime()) / 1000);

    const manualMinutesBaseline = actionRequests.map((request) => MANUAL_MINUTES_BY_ACTION[request.actionType] ?? 10);
    const platformTouchMinutes = actionRequests.map(
      (request) => PLATFORM_TOUCH_MINUTES_BY_DECISION[request.policyDecision] ?? 2
    );
    const minutesSaved = manualMinutesBaseline.map((minutes, index) => Math.max(minutes - platformTouchMinutes[index], 0));

    return {
      totals: {
        tickets: totalTickets,
        actionRequests: totalActions,
        approvals: approvals.length
      },
      automation: {
        autoExecuted,
        automationRatePct: toPercent(autoExecuted, totalActions),
        approvalRatePct: toPercent(approvalGated, totalActions),
        blockedRatePct: toPercent(blocked, totalActions)
      },
      outcomes: {
        succeeded,
        failed,
        successRatePct: toPercent(succeeded, totalActions)
      },
      operations: {
        avgResolutionSeconds: toAverage(cycleTimes),
        avgApprovalDecisionSeconds: toAverage(decidedApprovalLatencies),
        openApprovals: approvals.filter((approval) => approval.status === "PENDING").length,
        ticketsByAction,
        approvalsByStatus
      },
      roi: {
        estimatedManualMinutes: toSum(manualMinutesBaseline),
        estimatedPlatformTouchMinutes: toSum(platformTouchMinutes),
        estimatedMinutesSaved: toSum(minutesSaved),
        estimatedHoursSaved: Number((toSum(minutesSaved) / 60).toFixed(2))
      },
      demoMode: {
        baseline: {
          manualQueueMinutes: toSum(manualMinutesBaseline),
          platformQueueMinutes: toSum(platformTouchMinutes)
        },
        storyBeats: [
          "Show a low-risk unlock request auto-resolving with no operator touch.",
          "Show a medium-risk group-access request pausing for approval instead of executing directly.",
          "Show the audit trail proving the platform recorded classification, policy, approval, and execution.",
          "Use the ROI panel to compare the estimated manual queue against the platform-assisted path."
        ]
      },
      businessCase: {
        valueNarrative: [
          "Automation rate shows how much repetitive helpdesk work can be removed from the human queue.",
          "Approval rate shows how often the platform keeps humans in the loop for medium-risk access changes.",
          "Blocked rate demonstrates policy enforcement for unsafe or disallowed actions.",
          "Average resolution time shows whether the platform is compressing time-to-resolution for end users.",
          "Estimated minutes saved translates technical execution into a labor and margin story an MSP buyer can immediately understand."
        ]
      }
    };
  }
}
