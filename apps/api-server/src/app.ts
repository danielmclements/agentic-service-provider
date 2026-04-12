import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { authenticateOperatorSession, authenticateServiceToken, buildAuthorizeUrl, createOperatorSession, createPkcePair, extractBearerToken, hasFreshMfa, hasPermission, parseCookieHeader, serializeCookie, validateIdToken } from "@asp/auth";
import { prisma, env } from "@asp/config";
import { AuditLogService } from "@asp/audit-log";
import { ApprovalService } from "@asp/approval-service";
import { httpLogger } from "@asp/logger";
import { OperatorInsightsService } from "@asp/operator-insights";
import { signalApprovalDecision, signalVerificationDecision, startTicketWorkflow } from "@asp/orchestration";
import { TenantContextService } from "@asp/tenant-context";
import { TicketIntakeService } from "@asp/ticket-intake";
import { approvalDecisionSchema, ticketIntakeSchema, verificationDecisionSchema } from "@asp/validation";
import { AuthenticatedSession, OperatorPermission, ServicePrincipalContext } from "@asp/types";

const ticketIntakeService = new TicketIntakeService();
const tenantContextService = new TenantContextService();
const approvalService = new ApprovalService();
const auditLogService = new AuditLogService();
const operatorInsightsService = new OperatorInsightsService();

async function resolveTenantId(tenantIdOrSlug: string) {
  const tenantContext = await tenantContextService.getTenantContext(tenantIdOrSlug);
  return tenantContext.tenantId;
}

function unauthorized(res: express.Response, message = "Unauthorized", extras?: Record<string, unknown>) {
  res.status(401).json({
    error: message,
    ...(extras ?? {})
  });
}

function forbidden(res: express.Response, message = "Forbidden", extras?: Record<string, unknown>) {
  res.status(403).json({
    error: message,
    ...(extras ?? {})
  });
}

function getCookies(req: express.Request) {
  return parseCookieHeader(req.header("cookie"));
}

function getSessionId(req: express.Request) {
  return getCookies(req)[env.SESSION_COOKIE_NAME];
}

async function authenticateOperator(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const sessionId = getSessionId(req);

    if (!sessionId) {
      unauthorized(res, "Operator session required", { loginUrl: "/auth/login" });
      return;
    }

    req.operatorSession = await authenticateOperatorSession(sessionId);
    req.tenantId = req.operatorSession.tenantId;
    next();
  } catch (error) {
    unauthorized(res, error instanceof Error ? error.message : "Operator authentication failed", { loginUrl: "/auth/login" });
  }
}

async function authenticateOperatorPage(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const sessionId = getSessionId(req);

    if (!sessionId) {
      res.redirect("/auth/login");
      return;
    }

    req.operatorSession = await authenticateOperatorSession(sessionId);
    req.tenantId = req.operatorSession.tenantId;
    next();
  } catch (_error) {
    res.redirect("/auth/login");
  }
}

function requireOperatorPermission(permission: OperatorPermission, options?: { requireFreshMfa?: boolean }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = req.operatorSession;

    if (!session) {
      unauthorized(res, "Operator session required", { loginUrl: "/auth/login" });
      return;
    }

    if (!hasPermission(session, permission)) {
      forbidden(res, `Missing permission ${permission}`);
      return;
    }

    if (options?.requireFreshMfa && !hasFreshMfa(session)) {
      forbidden(res, "Fresh MFA is required for this action", {
        mfaRequired: true,
        reauthenticateUrl: "/auth/login?prompt=login"
      });
      return;
    }

    next();
  };
}

async function authenticateApiCaller(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const sessionId = getSessionId(req);
    if (sessionId) {
      req.operatorSession = await authenticateOperatorSession(sessionId);
      req.tenantId = req.operatorSession.tenantId;
      next();
      return;
    }

    const token = extractBearerToken(req.headers as Record<string, string | string[] | undefined>);
    if (!token) {
      unauthorized(res, "Authenticated caller required");
      return;
    }

    req.servicePrincipal = await authenticateServiceToken(token);
    req.tenantId = await resolveTenantId(req.servicePrincipal.tenantId);
    next();
  } catch (error) {
    unauthorized(res, error instanceof Error ? error.message : "API authentication failed");
  }
}

function requireApiPermission(permission: OperatorPermission) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.operatorSession) {
      if (!hasPermission(req.operatorSession, permission)) {
        forbidden(res, `Missing permission ${permission}`);
        return;
      }

      return next();
    }

    if (!req.servicePrincipal) {
      unauthorized(res, "Authenticated caller required");
      return;
    }

    if (!req.servicePrincipal.permissions.includes(permission)) {
      forbidden(res, `Missing permission ${permission}`);
      return;
    }

    next();
  };
}

function createCodeVerifierCookie(value: string) {
  return serializeCookie(env.AUTH_CODE_VERIFIER_COOKIE_NAME, value, { maxAge: 600 });
}

function createStateCookie(value: string) {
  return serializeCookie(env.AUTH_STATE_COOKIE_NAME, value, { maxAge: 600 });
}

function createNonceCookie(value: string) {
  return serializeCookie(env.AUTH_NONCE_COOKIE_NAME, value, { maxAge: 600 });
}

function createOrganizationCookie(value: string) {
  return serializeCookie(env.AUTH_ORGANIZATION_COOKIE_NAME, value, { maxAge: 600 });
}

function clearCookie(name: string) {
  return serializeCookie(name, "", { maxAge: 0 });
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  const response = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.AUTH0_CLIENT_ID,
      client_secret: env.AUTH0_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      redirect_uri: env.AUTH0_CALLBACK_URL
    })
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed with status ${response.status}`);
  }

  return (await response.json()) as { access_token?: string; id_token?: string };
}

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      operatorSession?: AuthenticatedSession;
      servicePrincipal?: ServicePrincipalContext;
    }
  }
}

export function createApp(): express.Express {
  const app = express();
  const operatorUiPath = path.resolve(process.cwd(), "apps/api-server/src/operator-ui");

  app.set("trust proxy", env.TRUST_PROXY);
  app.use(express.json());
  app.use(httpLogger);
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: "draft-8",
      legacyHeaders: false
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/operator/assets", express.static(path.join(operatorUiPath, "assets")));

  app.get("/operator", authenticateOperatorPage, requireOperatorPermission("tickets:read"), (_req, res) => {
    res.sendFile(path.join(operatorUiPath, "index.html"));
  });

  app.get("/auth/login", (req, res) => {
    const { codeVerifier, codeChallenge, state, nonce } = createPkcePair();
    const organization = typeof req.query.organization === "string" ? req.query.organization : env.AUTH0_DEFAULT_ORGANIZATION;
    res.setHeader("Set-Cookie", [
      createCodeVerifierCookie(codeVerifier),
      createStateCookie(state),
      createNonceCookie(nonce),
      organization ? createOrganizationCookie(organization) : clearCookie(env.AUTH_ORGANIZATION_COOKIE_NAME)
    ]);

    const prompt = typeof req.query.prompt === "string" ? req.query.prompt : undefined;
    res.redirect(buildAuthorizeUrl({ codeChallenge, state, nonce, organization, prompt }));
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : undefined;
      const state = typeof req.query.state === "string" ? req.query.state : undefined;
      const cookies = getCookies(req);

      if (!code || !state || cookies[env.AUTH_STATE_COOKIE_NAME] !== state) {
        unauthorized(res, "Auth callback state mismatch");
        return;
      }

      const codeVerifier = cookies[env.AUTH_CODE_VERIFIER_COOKIE_NAME];
      const nonce = cookies[env.AUTH_NONCE_COOKIE_NAME];
      const organization = cookies[env.AUTH_ORGANIZATION_COOKIE_NAME] || env.AUTH0_DEFAULT_ORGANIZATION;
      if (!codeVerifier) {
        unauthorized(res, "Missing PKCE verifier");
        return;
      }

      const tokenResponse = await exchangeAuthorizationCode(code, codeVerifier);
      if (!tokenResponse.id_token) {
        unauthorized(res, "ID token was not returned by Auth0");
        return;
      }

      const identity = await validateIdToken(tokenResponse.id_token, nonce);
      const operatorSession = await createOperatorSession(identity, organization);

      res.setHeader("Set-Cookie", [
        serializeCookie(env.SESSION_COOKIE_NAME, operatorSession.sessionId, { maxAge: 60 * 60 * 8 }),
        clearCookie(env.AUTH_CODE_VERIFIER_COOKIE_NAME),
        clearCookie(env.AUTH_STATE_COOKIE_NAME),
        clearCookie(env.AUTH_NONCE_COOKIE_NAME),
        clearCookie(env.AUTH_ORGANIZATION_COOKIE_NAME)
      ]);
      res.redirect("/operator");
    } catch (error) {
      unauthorized(res, error instanceof Error ? error.message : "Unable to complete auth callback");
    }
  });

  app.post("/auth/logout", async (req, res) => {
    const sessionId = getSessionId(req);
    if (sessionId) {
      await prisma.operatorSession.updateMany({
        where: { sessionId },
        data: { revokedAt: new Date() }
      });
    }

    res.setHeader("Set-Cookie", clearCookie(env.SESSION_COOKIE_NAME));
    res.json({
      ok: true,
      logoutUrl: `https://${env.AUTH0_DOMAIN}/v2/logout?client_id=${encodeURIComponent(env.AUTH0_CLIENT_ID)}&returnTo=${encodeURIComponent(
        env.AUTH0_LOGOUT_URL
      )}`
    });
  });

  app.get("/api/session", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        res.json({ authenticated: false, loginUrl: "/auth/login" });
        return;
      }

      const session = await authenticateOperatorSession(sessionId);
      res.json({
        authenticated: true,
        session
      });
    } catch (_error) {
      res.json({ authenticated: false, loginUrl: "/auth/login" });
    }
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "Agentic Service Provider MVP",
      status: "running",
      docs: {
        health: "/health",
        operatorConsole: "/operator",
        session: "/api/session",
        tickets: "/api/tickets",
        approvals: "/api/approvals",
        audit: "/api/audit/:ticketId",
        operatorSummary: "/api/operator-summary",
        businessMetrics: "/api/business-metrics",
        authLogin: "/auth/login"
      }
    });
  });

  app.post("/api/tickets", authenticateApiCaller, requireApiPermission("tickets:submit"), async (req, res) => {
    try {
      const input = ticketIntakeSchema.parse(req.body);
      const tenantId = req.tenantId!;

      if (req.operatorSession && input.tenant_id !== req.operatorSession.tenantId && input.tenant_id !== req.operatorSession.tenantSlug) {
        forbidden(res, "Operator tenant does not match requested tenant");
        return;
      }

      if (req.servicePrincipal) {
        const claimedTenantId = await resolveTenantId(input.tenant_id);
        if (claimedTenantId !== tenantId) {
          forbidden(res, "Service token tenant does not match request tenant");
          return;
        }
      }

      const idempotencyKey = req.header("idempotency-key") ?? undefined;
      const { ticket, executionRun, deduplicated } = await ticketIntakeService.createTicket(
        {
          ...input,
          tenant_id: tenantId
        },
        idempotencyKey
      );

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
        actor: req.operatorSession ? "operator" : "api",
        actorSubject: req.operatorSession?.userId,
        actorOrgId: req.operatorSession?.auth0OrganizationId,
        actorSessionId: req.operatorSession?.sessionId,
        actorDisplayName: req.operatorSession?.displayName,
        payload: {
          userEmail: ticket.userEmail,
          externalTicketRef: ticket.externalTicketRef ?? null,
          authenticatedClientId: req.servicePrincipal?.clientId ?? null
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

  app.get("/api/tickets", authenticateOperator, requireOperatorPermission("tickets:read"), async (req, res) => {
    const tickets = await ticketIntakeService.listTickets(req.tenantId!);
    res.json({ tickets });
  });

  app.get("/api/tickets/:id", authenticateOperator, requireOperatorPermission("tickets:read"), async (req, res) => {
    const ticketId = String(req.params.id);
    const ticket = await ticketIntakeService.getTicketView(ticketId, req.tenantId!);

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json({ ticket });
  });

  app.get("/api/approvals", authenticateOperator, requireOperatorPermission("approvals:read"), async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED") : undefined;
    const approvals = await approvalService.listApprovals(req.tenantId!, status);
    res.json({ approvals });
  });

  app.get("/api/operator-summary", authenticateOperator, requireOperatorPermission("tickets:read"), async (req, res) => {
    const summary = await operatorInsightsService.getOperatorSummary(req.tenantId!);
    res.json(summary);
  });

  app.get("/api/business-metrics", authenticateOperator, requireOperatorPermission("tickets:read"), async (req, res) => {
    const metrics = await operatorInsightsService.getBusinessMetrics(req.tenantId!);
    res.json(metrics);
  });

  app.post(
    "/api/approvals/:id/decision",
    authenticateOperator,
    requireOperatorPermission("approvals:decide", { requireFreshMfa: true }),
    async (req, res) => {
      try {
        const approvalId = String(req.params.id);
        const input = approvalDecisionSchema.parse(req.body);
        const reviewerIdentity = req.operatorSession?.displayName ?? req.operatorSession?.email ?? req.operatorSession!.userId;
        const result = await approvalService.applyDecision(approvalId, req.tenantId!, {
          decision: input.decision,
          comment: input.comment
        }, reviewerIdentity);

        await auditLogService.log({
          tenantId: req.tenantId!,
          ticketId: result.ticketId,
          actionRequestId: result.actionRequestId,
          eventType: "APPROVAL_DECIDED",
          actor: "operator",
          actorSubject: req.operatorSession?.userId,
          actorOrgId: req.operatorSession?.auth0OrganizationId,
          actorSessionId: req.operatorSession?.sessionId,
          actorDisplayName: req.operatorSession?.displayName,
          approvedBy: reviewerIdentity,
          payload: {
            approvalId: req.params.id,
            decision: input.decision,
            comment: input.comment ?? null,
            assurance: {
              amr: req.operatorSession?.amr ?? [],
              freshUntil: req.operatorSession?.mfaFreshUntil ?? 0
            }
          }
        });

        if (result.workflowId) {
          await signalApprovalDecision(result.workflowId, {
            approved: input.decision === "approve",
            reviewerIdentity
          });
        }

        res.json({ approval: result.approval });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : "Unable to apply decision"
        });
      }
    }
  );

  app.post("/api/verifications/:actionRequestId/complete", authenticateApiCaller, requireApiPermission("tickets:submit"), async (req, res) => {
    try {
      const actionRequestId = String(req.params.actionRequestId);
      const input = verificationDecisionSchema.parse(req.body);
      const actionRequest = await prisma.actionRequest.findUnique({
        where: { id: actionRequestId },
        include: {
          ticket: {
            include: {
              executionRuns: true
            }
          }
        }
      });

      if (!actionRequest || actionRequest.ticket.tenantId !== req.tenantId) {
        res.status(404).json({ error: "Verification challenge not found" });
        return;
      }

      const workflowId = actionRequest.ticket.executionRuns[0]?.workflowId;
      if (!workflowId) {
        res.status(400).json({ error: "No workflow is associated with this verification challenge" });
        return;
      }

      await signalVerificationDecision(workflowId, {
        status: input.status,
        evidencePayload: input.evidencePayload
      });

      await auditLogService.log({
        tenantId: req.tenantId!,
        ticketId: actionRequest.ticketId,
        actionRequestId,
        eventType: "VERIFICATION_SIGNALLED",
        actor: req.operatorSession ? "operator" : "api",
        actorSubject: req.operatorSession?.userId,
        actorOrgId: req.operatorSession?.auth0OrganizationId,
        actorSessionId: req.operatorSession?.sessionId,
        actorDisplayName: req.operatorSession?.displayName,
        payload: {
          status: input.status,
          method: input.method ?? null,
          evidencePayload: input.evidencePayload ?? {},
          authenticatedClientId: req.servicePrincipal?.clientId ?? null
        }
      });

      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to complete verification challenge"
      });
    }
  });

  app.get("/api/audit/:ticketId", authenticateOperator, requireOperatorPermission("audit:read"), async (req, res) => {
    const ticketId = String(req.params.ticketId);
    const events = await auditLogService.getTicketAuditTrail(ticketId, req.tenantId!);
    res.json({ events });
  });

  return app;
}
