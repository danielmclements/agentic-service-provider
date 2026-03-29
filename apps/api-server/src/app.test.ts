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
});
