import { describe, expect, it, vi } from "vitest";

vi.mock("@asp/config", () => ({
  env: {
    API_KEY: "dev-api-key",
    OPERATOR_API_KEY: "dev-operator-key",
    PORT: 4000
  },
  prisma: {
    executionRun: {
      create: vi.fn(async ({ data }) => data)
    }
  }
}));

vi.mock("@asp/tenant-context", () => ({
  TenantContextService: class {
    async getTenantContext() {
      return {
        tenantId: "tenant-1",
        tenantName: "Tenant",
        allowedActions: ["RESET_PASSWORD", "UNLOCK_ACCOUNT", "ADD_TO_GROUP"],
        approvalRules: {},
        identityProvider: "MOCK",
        model: {
          provider: "heuristic",
          modelName: "local"
        }
      };
    }
  }
}));

vi.mock("@asp/ticket-intake", () => ({
  TicketIntakeService: class {
    async createTicket() {
      return {
        ticket: {
          id: "ticket-1",
          tenantId: "tenant-1",
          userEmail: "user@example.com",
          status: "RECEIVED",
          externalTicketRef: null
        },
        executionRun: null,
        deduplicated: false
      };
    }

    async listTickets() {
      return [];
    }

    async getTicketView() {
      return null;
    }
  }
}));

vi.mock("@asp/orchestration", () => ({
  startTicketWorkflow: vi.fn(async () => ({
    workflowId: "ticket-ticket-1"
  })),
  signalApprovalDecision: vi.fn(async () => undefined)
}));

vi.mock("@asp/audit-log", () => ({
  AuditLogService: class {
    async log() {
      return undefined;
    }

    async getTicketAuditTrail() {
      return [];
    }
  }
}));

vi.mock("@asp/operator-insights", () => ({
  OperatorInsightsService: class {
    async getOperatorSummary() {
      return {
        totals: {
          tickets: 1,
          resolved: 1,
          waitingApproval: 0,
          blocked: 0,
          rejected: 0,
          pendingApprovals: 0
        },
        pendingApprovals: [],
        recentTickets: []
      };
    }

    async getBusinessMetrics() {
      return {
        totals: {
          tickets: 1,
          actionRequests: 1,
          approvals: 0
        },
        automation: {
          autoExecuted: 1,
          automationRatePct: 100,
          approvalRatePct: 0,
          blockedRatePct: 0
        },
        outcomes: {
          succeeded: 1,
          failed: 0,
          successRatePct: 100
        },
        operations: {
          avgResolutionSeconds: 1.2,
          openApprovals: 0,
          ticketsByAction: {
            UNLOCK_ACCOUNT: 1
          },
          approvalsByStatus: {}
        },
        businessCase: {
          valueNarrative: ["Automation reduces repetitive helpdesk work."]
        }
      };
    }
  }
}));

vi.mock("@asp/approval-service", () => ({
  ApprovalService: class {
    async listApprovals() {
      return [];
    }

    async applyDecision() {
      return {
        approval: {
          id: "approval-1",
          status: "APPROVED"
        },
        workflowId: "ticket-ticket-1"
      };
    }
  }
}));

import { createApp } from "./app";

describe("API server", () => {
  it("creates an express application without binding a port", () => {
    const app = createApp();

    expect(typeof app).toBe("function");
    expect(typeof app.use).toBe("function");
    expect(typeof app.listen).toBe("function");
  });

  it("returns a friendly root payload", async () => {
    const app = createApp();
    const router = (app as { router?: { stack?: Array<{ route?: { path?: string } }> } }).router;
    const paths =
      router?.stack
        ?.map((layer) => layer.route?.path)
        .filter((path): path is string => typeof path === "string") ?? [];

    expect(paths).toContain("/");
    expect(paths).toContain("/operator");
    expect(paths).toContain("/api/operator-summary");
    expect(paths).toContain("/api/business-metrics");
  });

  it("registers the operator summary endpoint", async () => {
    const app = createApp();
    const router = (app as { router?: { stack?: Array<{ route?: { path?: string } }> } }).router;
    const operatorSummaryRoute = router?.stack?.find((layer) => layer.route?.path === "/api/operator-summary");

    expect(operatorSummaryRoute).toBeTruthy();
  });

  it("registers the business metrics endpoint", async () => {
    const app = createApp();
    const router = (app as { router?: { stack?: Array<{ route?: { path?: string } }> } }).router;
    const businessMetricsRoute = router?.stack?.find((layer) => layer.route?.path === "/api/business-metrics");

    expect(businessMetricsRoute).toBeTruthy();
  });
});
