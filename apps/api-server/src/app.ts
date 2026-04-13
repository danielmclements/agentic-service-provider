import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { TenantRole as PrismaTenantRole } from "@prisma/client";
import { authenticateOperatorSession, authenticateServiceToken, buildAuthorizeUrl, createOperatorSession, createPkcePair, extractBearerToken, hasFreshMfa, hasGlobalRole, hasPermission, parseCookieHeader, serializeCookie, switchOperatorTenant, validateIdToken } from "@asp/auth";
import { prisma, env } from "@asp/config";
import { AuditLogService } from "@asp/audit-log";
import { ApprovalService } from "@asp/approval-service";
import { httpLogger } from "@asp/logger";
import { OperatorInsightsService } from "@asp/operator-insights";
import { signalApprovalDecision, signalVerificationDecision, startTicketWorkflow } from "@asp/orchestration";
import { TenantContextService } from "@asp/tenant-context";
import { TicketIntakeService } from "@asp/ticket-intake";
import { UserAdminService } from "@asp/user-admin";
import { approvalDecisionSchema, ticketIntakeSchema, userCreateSchema, userMembershipCreateSchema, userMembershipUpdateSchema, userUpdateSchema, verificationDecisionSchema } from "@asp/validation";
import { AuthenticatedSession, GlobalRole, OperatorPermission, ServicePrincipalContext, TENANT_ROLES, TenantRole } from "@asp/types";

const ticketIntakeService = new TicketIntakeService();
const tenantContextService = new TenantContextService();
const approvalService = new ApprovalService();
const auditLogService = new AuditLogService();
const operatorInsightsService = new OperatorInsightsService();
const userAdminService = new UserAdminService();

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

function sessionHasGlobalRole(session: AuthenticatedSession | undefined, role: GlobalRole) {
  return Boolean(session && hasGlobalRole(session, role));
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

function requireMembershipAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = req.operatorSession;

  if (!session) {
    unauthorized(res, "Operator session required", { loginUrl: "/auth/login" });
    return;
  }

  if (!sessionHasGlobalRole(session, "superadmin") && !hasPermission(session, "memberships:write")) {
    forbidden(res, "Membership administration is not available in this session");
    return;
  }

  next();
}

function requireUserAdminRead(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = req.operatorSession;

  if (!session) {
    unauthorized(res, "Operator session required", { loginUrl: "/auth/login" });
    return;
  }

  if (!sessionHasGlobalRole(session, "superadmin") && !hasPermission(session, "memberships:read") && !hasPermission(session, "memberships:write")) {
    forbidden(res, "User administration visibility is not available in this session");
    return;
  }

  next();
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

function toPrismaTenantRole(role: TenantRole): PrismaTenantRole {
  if (!(TENANT_ROLES as readonly string[]).includes(role)) {
    throw new Error("tenantRole is invalid");
  }

  return role.toUpperCase() as PrismaTenantRole;
}

function readTenantSwitchInput(body: unknown) {
  if (!body || typeof body !== "object" || typeof (body as { tenantId?: unknown }).tenantId !== "string") {
    throw new Error("tenantId is required");
  }

  return {
    tenantId: (body as { tenantId: string }).tenantId
  };
}

function readMembershipUpsertInput(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Membership payload is required");
  }

  const candidate = body as {
    tenantId?: unknown;
    auth0UserId?: unknown;
    email?: unknown;
    displayName?: unknown;
    tenantRole?: unknown;
    permissions?: unknown;
    globalRoles?: unknown;
  };

  if (typeof candidate.tenantRole !== "string") {
    throw new Error("tenantRole is required");
  }

  if (typeof candidate.auth0UserId !== "string" && typeof candidate.email !== "string") {
    throw new Error("auth0UserId or email is required");
  }

  return {
    tenantId: typeof candidate.tenantId === "string" ? candidate.tenantId : undefined,
    auth0UserId: typeof candidate.auth0UserId === "string" ? candidate.auth0UserId : undefined,
    email: typeof candidate.email === "string" ? candidate.email : undefined,
    displayName: typeof candidate.displayName === "string" ? candidate.displayName : undefined,
    tenantRole: candidate.tenantRole as TenantRole,
    permissions: Array.isArray(candidate.permissions) ? candidate.permissions.filter((value): value is string => typeof value === "string") : undefined,
    globalRoles: Array.isArray(candidate.globalRoles) ? candidate.globalRoles.filter((value): value is string => typeof value === "string") : undefined
  };
}

function readMembershipPatchInput(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Membership payload is required");
  }

  const candidate = body as {
    tenantRole?: unknown;
    permissions?: unknown;
    active?: unknown;
    globalRoles?: unknown;
  };

  return {
    tenantRole: typeof candidate.tenantRole === "string" ? (candidate.tenantRole as TenantRole) : undefined,
    permissions: Array.isArray(candidate.permissions) ? candidate.permissions.filter((value): value is string => typeof value === "string") : undefined,
    active: typeof candidate.active === "boolean" ? candidate.active : undefined,
    globalRoles: Array.isArray(candidate.globalRoles) ? candidate.globalRoles.filter((value): value is string => typeof value === "string") : undefined
  };
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

  app.post("/api/session/switch-tenant", authenticateOperator, async (req, res) => {
    try {
      const { tenantId } = readTenantSwitchInput(req.body);
      const session = await switchOperatorTenant(req.operatorSession!.sessionId, tenantId);
      req.operatorSession = session;
      req.tenantId = session.tenantId;
      res.json({ ok: true, session });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to switch tenant"
      });
    }
  });

  app.get("/api/admin/users", authenticateOperator, requireUserAdminRead, async (req, res) => {
    try {
      const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
      const users = await userAdminService.listUsers(req.operatorSession!, { tenantId });
      res.json({ users });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to load users"
      });
    }
  });

  app.get("/api/admin/users/:id", authenticateOperator, requireUserAdminRead, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const user = await userAdminService.getUser(req.operatorSession!, userId);
      res.json({ user });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to load user"
      });
    }
  });

  app.post("/api/admin/users", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const input = userCreateSchema.parse(req.body);
      const result = await userAdminService.createUser(req.operatorSession!, input);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to create user"
      });
    }
  });

  app.patch("/api/admin/users/:id", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const input = userUpdateSchema.parse(req.body);
      const result = await userAdminService.updateUser(req.operatorSession!, userId, input);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to update user"
      });
    }
  });

  app.delete("/api/admin/users/:id", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await userAdminService.deactivateUser(req.operatorSession!, userId);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to deactivate user"
      });
    }
  });

  app.post("/api/admin/users/:id/invite", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await userAdminService.inviteUser(req.operatorSession!, userId);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to invite user"
      });
    }
  });

  app.get("/api/admin/users/:id/memberships", authenticateOperator, requireUserAdminRead, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const memberships = await userAdminService.listMemberships(req.operatorSession!, userId);
      res.json({ memberships });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to load memberships"
      });
    }
  });

  app.post("/api/admin/users/:id/memberships", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const input = userMembershipCreateSchema.parse(req.body);
      const result = await userAdminService.addMembership(req.operatorSession!, userId, input);
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to create membership"
      });
    }
  });

  app.patch("/api/admin/memberships/:id", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const membershipId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const input = userMembershipUpdateSchema.parse(req.body);
      const result = await userAdminService.updateMembership(req.operatorSession!, membershipId, input);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to update membership"
      });
    }
  });

  app.get("/api/memberships", authenticateOperator, async (req, res) => {
    try {
      const session = req.operatorSession!;
      if (!sessionHasGlobalRole(session, "superadmin") && !hasPermission(session, "memberships:read")) {
        forbidden(res, "Membership visibility is not available in this session");
        return;
      }

      const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : session.tenantId;
      const memberships = await prisma.tenantMembership.findMany({
        where: {
          tenant: {
            OR: [{ id: tenantId }, { slug: tenantId }]
          }
        },
        include: {
          tenant: true,
          user: true
        },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }]
      });

      res.json({
        memberships: memberships.map((membership) => ({
          id: membership.id,
          tenantId: membership.tenantId,
          tenantSlug: membership.tenant.slug,
          tenantName: membership.tenant.name,
          userId: membership.user.auth0UserId,
          email: membership.email ?? membership.user.email,
          displayName: membership.displayName ?? membership.user.displayName,
          tenantRole: membership.role.toLowerCase(),
          permissions: membership.permissions,
          active: membership.active,
          globalRoles: membership.user.globalRoles
        }))
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to load memberships"
      });
    }
  });

  app.post("/api/memberships", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const session = req.operatorSession!;
      const input = readMembershipUpsertInput(req.body);
      const targetTenantId = input.tenantId ?? session.tenantId;
      const tenant = await prisma.tenant.findFirst({
        where: {
          OR: [{ id: targetTenantId }, { slug: targetTenantId }]
        }
      });

      if (!tenant) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }

      if (!sessionHasGlobalRole(session, "superadmin") && tenant.id !== session.tenantId) {
        forbidden(res, "This session cannot manage memberships for another tenant");
        return;
      }

      const user = await prisma.user.findFirst({
        where: input.auth0UserId
          ? { auth0UserId: input.auth0UserId }
          : {
              email: {
                equals: input.email,
                mode: "insensitive"
              }
            }
      });

      if (!user) {
        res.status(404).json({
          error: "User not found. The user must sign in once or be provisioned before a membership can be assigned."
        });
        return;
      }

      const authConnection = await prisma.tenantAuthConnection.findFirst({
        where: { tenantId: tenant.id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
      });

      if (!authConnection) {
        res.status(400).json({ error: "Tenant is missing an Auth0 organization mapping" });
        return;
      }

      const membership = await prisma.tenantMembership.upsert({
        where: {
          tenantId_userId: {
            tenantId: tenant.id,
            userId: user.id
          }
        },
        update: {
          email: input.email ?? user.email,
          displayName: input.displayName ?? user.displayName,
          auth0OrgId: authConnection.auth0OrganizationId,
          role: toPrismaTenantRole(input.tenantRole),
          permissions: input.permissions ?? undefined,
          active: true
        },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          auth0OrgId: authConnection.auth0OrganizationId,
          email: input.email ?? user.email,
          displayName: input.displayName ?? user.displayName,
          role: toPrismaTenantRole(input.tenantRole),
          permissions: input.permissions ?? [],
          active: true
        }
      });

      if (input.globalRoles && sessionHasGlobalRole(session, "superadmin")) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            globalRoles: input.globalRoles
          }
        });
      }

      res.status(201).json({
        membershipId: membership.id,
        tenantId: membership.tenantId,
        userId: user.auth0UserId
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to save membership"
      });
    }
  });

  app.patch("/api/memberships/:id", authenticateOperator, requireMembershipAdmin, async (req, res) => {
    try {
      const session = req.operatorSession!;
      const membershipId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const existingMembership = await prisma.tenantMembership.findUnique({
        where: { id: membershipId },
        include: {
          tenant: true,
          user: true
        }
      });

      if (!existingMembership) {
        res.status(404).json({ error: "Membership not found" });
        return;
      }

      if (!sessionHasGlobalRole(session, "superadmin") && existingMembership.tenantId !== session.tenantId) {
        forbidden(res, "This session cannot update memberships for another tenant");
        return;
      }

      const patch = readMembershipPatchInput(req.body);
      const updatedMembership = await prisma.tenantMembership.update({
        where: { id: existingMembership.id },
        data: {
          role: patch.tenantRole ? toPrismaTenantRole(patch.tenantRole) : undefined,
          permissions: patch.permissions ?? undefined,
          active: patch.active
        }
      });

      if (patch.globalRoles && sessionHasGlobalRole(session, "superadmin")) {
        await prisma.user.update({
          where: { id: existingMembership.userId },
          data: {
            globalRoles: patch.globalRoles
          }
        });
      }

      res.json({
        membershipId: updatedMembership.id,
        active: updatedMembership.active
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to update membership"
      });
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
