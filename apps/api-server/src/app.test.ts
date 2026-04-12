import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executionRunCreate: vi.fn(async ({ data }) => data),
  actionRequestFindUnique: vi.fn(),
  operatorSessionUpdateMany: vi.fn(async () => ({ count: 1 })),
  listTickets: vi.fn(async () => []),
  getTicketView: vi.fn(async () => null),
  createTicket: vi.fn(async () => ({
    ticket: {
      id: "ticket-1",
      tenantId: "tenant-1",
      userEmail: "user@example.com",
      status: "RECEIVED",
      externalTicketRef: null
    },
    executionRun: null,
    deduplicated: false
  })),
  getOperatorSummary: vi.fn(async (tenantId: string) => ({
    totals: {
      tickets: 1,
      resolved: 1,
      waitingApproval: 0,
      blocked: 0,
      rejected: 0,
      pendingApprovals: 0
    },
    pendingApprovals: [],
    recentTickets: [],
    tenantId
  })),
  getBusinessMetrics: vi.fn(async () => ({
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
      approvalsByStatus: {},
      avgApprovalDecisionSeconds: 0
    },
    roi: {
      estimatedMinutesSaved: 10,
      estimatedHoursSaved: 0.2,
      estimatedManualMinutes: 15,
      estimatedPlatformTouchMinutes: 5
    },
    businessCase: {
      valueNarrative: ["Automation reduces repetitive helpdesk work."]
    },
    demoMode: {
      baseline: {
        manualQueueMinutes: 15,
        platformQueueMinutes: 5
      },
      storyBeats: ["Request created", "Policy evaluated", "Outcome recorded"]
    }
  })),
  applyDecision: vi.fn(async () => ({
    approval: {
      id: "approval-1",
      status: "APPROVED"
    },
    workflowId: "ticket-ticket-1",
    ticketId: "ticket-1",
    actionRequestId: "action-request-1"
  })),
  signalApprovalDecision: vi.fn(async () => undefined),
  signalVerificationDecision: vi.fn(async () => undefined),
  startTicketWorkflow: vi.fn(async () => ({
    workflowId: "ticket-ticket-1"
  })),
  auditLog: vi.fn(async () => undefined)
}));

vi.mock("@asp/config", () => ({
  env: {
    PORT: 4000,
    AUTH0_DOMAIN: "example.us.auth0.com",
    AUTH0_CLIENT_ID: "operator-console",
    AUTH0_LOGOUT_URL: "http://localhost:4000/operator",
    SESSION_COOKIE_NAME: "asp_operator_session",
    AUTH_CODE_VERIFIER_COOKIE_NAME: "asp_auth_code_verifier",
    AUTH_STATE_COOKIE_NAME: "asp_auth_state",
    AUTH_NONCE_COOKIE_NAME: "asp_auth_nonce",
    AUTH_ORGANIZATION_COOKIE_NAME: "asp_auth_organization",
    AUTH0_DEFAULT_ORGANIZATION: "org_acme"
  },
  prisma: {
    executionRun: {
      create: mocks.executionRunCreate
    },
    actionRequest: {
      findUnique: mocks.actionRequestFindUnique
    },
    operatorSession: {
      updateMany: mocks.operatorSessionUpdateMany
    }
  }
}));

vi.mock("@asp/auth", () => {
  const operatorSession = {
    userId: "auth0|alice",
    email: "alice@example.com",
    displayName: "Alice Admin",
    sessionId: "sid-1",
    auth0OrganizationId: "org_acme",
    tenantId: "tenant-1",
    tenantSlug: "acme",
    tenantName: "Acme",
    roles: ["tenant_admin"],
    permissions: ["tickets:read", "tickets:submit", "approvals:read", "approvals:decide", "audit:read"],
    authTime: 100,
    amr: ["pwd", "mfa"],
    mfaFreshUntil: Math.floor(Date.now() / 1000) + 300
  };

  return {
    authenticateOperatorSession: vi.fn(async (sessionId: string) => {
      if (sessionId === "operator-valid") {
        return operatorSession;
      }

      if (sessionId === "operator-readonly") {
        return {
          ...operatorSession,
          permissions: ["approvals:read"]
        };
      }

      if (sessionId === "operator-stale") {
        return {
          ...operatorSession,
          amr: ["pwd"],
          mfaFreshUntil: Math.floor(Date.now() / 1000) - 1
        };
      }

      throw new Error("invalid token");
    }),
    authenticateServiceToken: vi.fn((token: string) => {
      if (token === "service-tenant-1") {
        return {
          clientId: "svc-client",
          tenantId: "tenant-1",
          permissions: ["tickets:submit"]
        };
      }

      throw new Error("invalid service token");
    }),
    extractBearerToken: vi.fn((headers: Record<string, string | string[] | undefined>) => {
      const authorization = headers.authorization;
      if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length);
      }

      return undefined;
    }),
    validateIdToken: vi.fn(async () => ({
      userId: "auth0|alice",
      email: "alice@example.com",
      displayName: "Alice Admin",
      authTime: 100,
      amr: ["pwd", "mfa"]
    })),
    createOperatorSession: vi.fn(async () => operatorSession),
    hasPermission: vi.fn((session, permission) => session.permissions.includes(permission)),
    hasFreshMfa: vi.fn((session) => session.amr.includes("mfa") && session.mfaFreshUntil > Math.floor(Date.now() / 1000)),
    buildAuthorizeUrl: vi.fn(() => "https://example.us.auth0.com/authorize"),
    createPkcePair: vi.fn(() => ({
      codeVerifier: "verifier",
      codeChallenge: "challenge",
      state: "state",
      nonce: "nonce"
    })),
    parseCookieHeader: vi.fn((header: string | undefined) => {
      if (!header) {
        return {};
      }

      return header.split(";").reduce<Record<string, string>>((acc, part) => {
        const [key, ...rest] = part.trim().split("=");
        if (!key) {
          return acc;
        }

        acc[key] = rest.join("=");
        return acc;
      }, {});
    }),
    serializeCookie: vi.fn((name: string, value: string) => `${name}=${value}`)
  };
});

vi.mock("@asp/tenant-context", () => ({
  TenantContextService: class {
    async getTenantContext(tenantIdOrSlug: string) {
      return {
        tenantId: tenantIdOrSlug === "tenant-2" ? "tenant-2" : "tenant-1",
        tenantName: "Tenant",
        allowedActions: ["RESET_PASSWORD", "UNLOCK_ACCOUNT", "ADD_TO_GROUP"],
        approvalRules: {},
        identityProvider: "MOCK",
        verification: {
          requiredActions: ["RESET_PASSWORD"],
          primaryMethod: "PUSH",
          allowSmsFallback: true,
          requireManualReviewOnMissingFactor: true,
          challengeTtlMinutes: 10
        },
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
    createTicket = mocks.createTicket;
    listTickets = mocks.listTickets;
    getTicketView = mocks.getTicketView;
  }
}));

vi.mock("@asp/orchestration", () => ({
  startTicketWorkflow: mocks.startTicketWorkflow,
  signalApprovalDecision: mocks.signalApprovalDecision,
  signalVerificationDecision: mocks.signalVerificationDecision
}));

vi.mock("@asp/audit-log", () => ({
  AuditLogService: class {
    log = mocks.auditLog;
    async getTicketAuditTrail() {
      return [];
    }
  }
}));

vi.mock("@asp/operator-insights", () => ({
  OperatorInsightsService: class {
    getOperatorSummary = mocks.getOperatorSummary;
    getBusinessMetrics = mocks.getBusinessMetrics;
  }
}));

vi.mock("@asp/approval-service", () => ({
  ApprovalService: class {
    async listApprovals() {
      return [];
    }

    applyDecision = mocks.applyDecision;
  }
}));

import { createApp } from "./app";

function findRouteHandlers(app: ReturnType<typeof createApp>, path: string, method: "get" | "post") {
  const router = (app as unknown as { router?: { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: Function }> } }> } }).router;
  const layer = router?.stack?.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);

  if (!layer?.route?.stack) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }

  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(
  app: ReturnType<typeof createApp>,
  method: "get" | "post",
  path: string,
  input: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    params?: Record<string, string>;
  } = {}
) {
  const handlers = findRouteHandlers(app, path, method);
  const req = {
    method: method.toUpperCase(),
    headers: Object.fromEntries(Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
    body: input.body ?? {},
    query: input.query ?? {},
    params: input.params ?? {},
    header(name: string) {
      return this.headers[name.toLowerCase()];
    }
  } as Record<string, unknown> & {
    headers: Record<string, string>;
    header: (name: string) => string | undefined;
  };

  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    sendFile(filePath: string) {
      this.body = { filePath };
      return this;
    },
    redirect(location: string) {
      this.statusCode = 302;
      this.body = { location };
      return this;
    },
    setHeader(name: string, value: unknown) {
      this.headers[name.toLowerCase()] = value;
    }
  };

  let index = 0;
  const next = async () => {
    const handler = handlers[index++];
    if (!handler) {
      return;
    }

    await handler(req, res, next);
  };

  await next();
  return res;
}

describe("API server auth model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthenticated session metadata when no operator token is present", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "get", "/api/session");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      authenticated: false,
      loginUrl: "/auth/login"
    });
  });

  it("redirects anonymous browser requests for the operator console to Auth0 login", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "get", "/operator");

    expect(response.statusCode).toBe(302);
    expect(response.body).toEqual({
      location: "/auth/login"
    });
  });

  it("serves the operator console only to authenticated operator sessions", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "get", "/operator", {
      headers: {
        cookie: "asp_operator_session=operator-valid"
      }
    });

    expect(response.statusCode).toBe(200);
  });

  it("uses the tenant from the operator session rather than a spoofed header", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "get", "/api/operator-summary", {
      headers: {
        cookie: "asp_operator_session=operator-valid",
        "x-tenant-id": "tenant-2"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getOperatorSummary).toHaveBeenCalledWith("tenant-1");
  });

  it("rejects requests when the authenticated operator lacks permission", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "get", "/api/operator-summary", {
      headers: {
        cookie: "asp_operator_session=operator-readonly"
      }
    });

    expect(response.statusCode).toBe(403);
    expect((response.body as { error: string }).error).toContain("tickets:read");
  });

  it("requires fresh MFA before approving an approval-gated action", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "post", "/api/approvals/:id/decision", {
      headers: {
        cookie: "asp_operator_session=operator-stale"
      },
      params: {
        id: "approval-1"
      },
      body: {
        decision: "approve",
        reviewerIdentity: "Spoofed Reviewer"
      }
    });

    expect(response.statusCode).toBe(403);
    expect((response.body as { mfaRequired: boolean }).mfaRequired).toBe(true);
    expect(mocks.applyDecision).not.toHaveBeenCalled();
  });

  it("uses the authenticated operator identity instead of a caller-supplied reviewer identity", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "post", "/api/approvals/:id/decision", {
      headers: {
        cookie: "asp_operator_session=operator-valid"
      },
      params: {
        id: "approval-1"
      },
      body: {
        decision: "approve",
        reviewerIdentity: "Spoofed Reviewer",
        comment: "Looks fine"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.applyDecision).toHaveBeenCalledWith(
      "approval-1",
      "tenant-1",
      {
        decision: "approve",
        comment: "Looks fine"
      },
      "Alice Admin"
    );
    expect(mocks.signalApprovalDecision).toHaveBeenCalledWith("ticket-ticket-1", {
      approved: true,
      reviewerIdentity: "Alice Admin"
    });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "APPROVAL_DECIDED",
      ticketId: "ticket-1",
      actionRequestId: "action-request-1",
      approvedBy: "Alice Admin"
    }));
  });

  it("rejects service tokens that submit tickets for a different tenant than their claim", async () => {
    const app = createApp();
    const response = await invokeRoute(app, "post", "/api/tickets", {
      headers: {
        authorization: "Bearer service-tenant-1"
      },
      body: {
        tenant_id: "tenant-2",
        user_email: "user@example.com",
        message: "Please reset my password"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });
});
