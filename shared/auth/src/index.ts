import crypto from "node:crypto";
import { Prisma, TenantRole as PrismaTenantRole } from "@prisma/client";
import { env, prisma } from "@asp/config";
import {
  AuthenticatedSession,
  AuthorizationRole,
  GLOBAL_ROLES,
  GlobalRole,
  OPERATOR_PERMISSIONS,
  OperatorPermission,
  ServicePrincipalContext,
  TENANT_ROLES,
  TenantRole
} from "@asp/types";

type JwtPayload = Record<string, unknown> & {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  auth_time?: number;
  amr?: string[];
  email?: string;
  name?: string;
  nonce?: string;
  azp?: string;
};

export type OperatorIdentity = {
  userId: string;
  email?: string;
  displayName?: string;
  authTime: number;
  amr: string[];
};

type Jwk = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  x5c?: string[];
};

type SessionMembershipSummary = AuthenticatedSession["memberships"][number];

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, { publicKey: string; expiresAt: number }>();

const tenantRolePermissions: Record<TenantRole, OperatorPermission[]> = {
  tenant_admin: [
    "tickets:read",
    "tickets:submit",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "connectors:admin",
    "tenants:admin",
    "memberships:read",
    "memberships:write"
  ],
  tenant_operator: [
    "tickets:read",
    "tickets:submit",
    "approvals:read",
    "approvals:decide",
    "audit:read"
  ],
  tenant_end_user: [
    "tickets:read",
    "tickets:submit"
  ]
};

const globalRolePermissions: Record<GlobalRole, OperatorPermission[]> = {
  superadmin: [...OPERATOR_PERMISSIONS],
  internal_operator: []
};

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseJwt(token: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Malformed bearer token");
  }

  return {
    signingInput: `${encodedHeader}.${encodedPayload}`,
    header: parseJson<Record<string, unknown>>(fromBase64Url(encodedHeader).toString("utf8")),
    payload: parseJson<JwtPayload>(fromBase64Url(encodedPayload).toString("utf8")),
    signature: fromBase64Url(encodedSignature)
  };
}

function verifyHs256(signingInput: string, signature: Buffer) {
  if (!env.AUTH0_JWT_SECRET) {
    throw new Error("AUTH0_JWT_SECRET is required for HS256 token validation");
  }

  const expected = crypto.createHmac("sha256", env.AUTH0_JWT_SECRET).update(signingInput).digest();
  return crypto.timingSafeEqual(expected, signature);
}

function verifyRs256(signingInput: string, signature: Buffer) {
  if (!env.AUTH0_JWT_PUBLIC_KEY) {
    throw new Error("AUTH0_JWT_PUBLIC_KEY is required for RS256 token validation");
  }

  return crypto.verify("RSA-SHA256", Buffer.from(signingInput), env.AUTH0_JWT_PUBLIC_KEY, signature);
}

function jwkToPublicKey(jwk: Jwk) {
  if (jwk.x5c?.[0]) {
    return `-----BEGIN CERTIFICATE-----\n${jwk.x5c[0]}\n-----END CERTIFICATE-----`;
  }

  if (jwk.kty === "RSA" && jwk.n && jwk.e) {
    return crypto.createPublicKey({
      key: {
        kty: "RSA",
        n: jwk.n,
        e: jwk.e
      },
      format: "jwk"
    }).export({ type: "spki", format: "pem" }).toString();
  }

  throw new Error("JWKS entry is missing a supported RSA public key");
}

async function getJwksPublicKey(kid: string) {
  const cached = jwksCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.publicKey;
  }

  const jwksUrl = env.AUTH0_JWKS_URL ?? `https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`;
  const response = await fetch(jwksUrl, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`JWKS fetch failed with status ${response.status}`);
  }

  const body = (await response.json()) as { keys?: Jwk[] };
  const key = body.keys?.find((candidate) => candidate.kid === kid);
  if (!key) {
    throw new Error(`Unable to find JWKS key for kid ${kid}`);
  }

  const publicKey = jwkToPublicKey(key);
  jwksCache.set(kid, {
    publicKey,
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS
  });

  return publicKey;
}

async function validateJwtToken(token: string, expectedAudience: string, options?: { nonce?: string }) {
  const { header, payload, signature, signingInput } = parseJwt(token);
  const alg = String(header.alg ?? "");
  const allowed = env.AUTH0_JWT_ALGORITHMS.split(",").map((item) => item.trim()).filter(Boolean);

  if (!allowed.includes(alg)) {
    throw new Error(`JWT algorithm ${alg} is not allowed`);
  }

  let valid = false;
  if (alg === "HS256") {
    valid = verifyHs256(signingInput, signature);
  } else if (alg === "RS256") {
    const kid = typeof header.kid === "string" ? header.kid : undefined;
    if (kid) {
      const jwksPublicKey = await getJwksPublicKey(kid);
      valid = crypto.verify("RSA-SHA256", Buffer.from(signingInput), jwksPublicKey, signature);
    } else {
      valid = verifyRs256(signingInput, signature);
    }
  }

  if (!valid) {
    throw new Error("Bearer token signature is invalid");
  }

  const issuer = env.AUTH0_ISSUER ?? `https://${env.AUTH0_DOMAIN}/`;
  if (payload.iss !== issuer) {
    throw new Error("Bearer token issuer is invalid");
  }

  const audience = payload.aud;
  const audienceList = Array.isArray(audience) ? audience : audience ? [audience] : [];
  if (!audienceList.includes(expectedAudience)) {
    throw new Error("Bearer token audience is invalid");
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    throw new Error("Bearer token is expired");
  }

  if (options?.nonce && payload.nonce !== options.nonce) {
    throw new Error("ID token nonce is invalid");
  }

  return payload;
}

function coercePermissions(input: unknown): OperatorPermission[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter(
    (permission): permission is OperatorPermission =>
      typeof permission === "string" && (OPERATOR_PERMISSIONS as readonly string[]).includes(permission)
  );
}

function coerceGlobalRoles(input: unknown): GlobalRole[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((role): role is GlobalRole => typeof role === "string" && (GLOBAL_ROLES as readonly string[]).includes(role));
}

function toTenantRole(role: PrismaTenantRole): TenantRole {
  return role.toLowerCase() as TenantRole;
}

function unionPermissions(input: { globalRoles: GlobalRole[]; tenantRole?: TenantRole; permissions?: OperatorPermission[] }) {
  const combined = new Set<OperatorPermission>(input.permissions ?? []);

  for (const role of input.globalRoles) {
    for (const permission of globalRolePermissions[role] ?? []) {
      combined.add(permission);
    }
  }

  if (input.tenantRole) {
    for (const permission of tenantRolePermissions[input.tenantRole] ?? []) {
      combined.add(permission);
    }
  }

  return [...combined];
}

function unionRoles(input: { globalRoles: GlobalRole[]; tenantRole?: TenantRole }): AuthorizationRole[] {
  return [...input.globalRoles, ...(input.tenantRole ? [input.tenantRole] : [])];
}

export function extractBearerToken(headers: Record<string, string | string[] | undefined>) {
  const authorization = headers.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (headerValue?.startsWith("Bearer ")) {
    return headerValue.slice("Bearer ".length);
  }
}

export function parseCookieHeader(header: string | undefined) {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      return acc;
    }

    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

export function serializeCookie(name: string, value: string, options: { maxAge?: number; path?: string; httpOnly?: boolean; sameSite?: "Lax" | "Strict"; secure?: boolean } = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];

  if (typeof options.maxAge === "number") {
    segments.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly ?? true) {
    segments.push("HttpOnly");
  }

  if (options.sameSite ?? "Lax") {
    segments.push(`SameSite=${options.sameSite ?? "Lax"}`);
  }

  if (options.secure ?? env.NODE_ENV === "production") {
    segments.push("Secure");
  }

  return segments.join("; ");
}

async function resolveTenantAuthConnection(organization: string) {
  const authConnection = await prisma.tenantAuthConnection.findFirst({
    where: {
      OR: [{ auth0OrganizationId: organization }, { auth0OrganizationName: organization }]
    },
    include: { tenant: true }
  });

  if (!authConnection) {
    throw new Error("No tenant is mapped to the provided Auth0 organization");
  }

  return authConnection;
}

async function resolveTenantByIdOrSlug(tenantIdOrSlug: string) {
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ id: tenantIdOrSlug }, { slug: tenantIdOrSlug }]
    }
  });

  if (!tenant) {
    throw new Error("Tenant could not be found");
  }

  return tenant;
}

async function resolveTenantDefaultAuthConnection(tenantId: string) {
  const authConnection = await prisma.tenantAuthConnection.findFirst({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });

  if (!authConnection) {
    throw new Error("No Auth0 organization is mapped to the selected tenant");
  }

  return authConnection;
}

async function upsertUser(identity: OperatorIdentity) {
  const user = await prisma.user.upsert({
    where: { auth0UserId: identity.userId },
    create: {
      auth0UserId: identity.userId,
      email: identity.email ?? null,
      displayName: identity.displayName ?? null,
      globalRoles: []
    },
    update: {
      email: identity.email,
      displayName: identity.displayName
    }
  });

  if (!user.active) {
    throw new Error("Authenticated user is inactive");
  }

  return user;
}

async function resolveMembershipForLogin(userId: string, tenantId: string, email?: string, displayName?: string, auth0OrgId?: string) {
  let membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId,
      userId,
      active: true
    }
  });

  if (!membership && email) {
    const matchingMemberships = await prisma.tenantMembership.findMany({
      where: {
        tenantId,
        active: true,
        email: {
          equals: email,
          mode: "insensitive"
        }
      }
    });

    if (matchingMemberships.length === 1) {
      membership = await prisma.tenantMembership.update({
        where: { id: matchingMemberships[0].id },
        data: {
          userId,
          auth0OrgId: auth0OrgId ?? matchingMemberships[0].auth0OrgId,
          email,
          displayName: displayName ?? matchingMemberships[0].displayName
        }
      });
    }
  }

  return membership;
}

async function resolveUserMemberships(userId: string): Promise<SessionMembershipSummary[]> {
  const memberships = await prisma.tenantMembership.findMany({
    where: {
      userId,
      active: true
    },
    include: {
      tenant: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    tenantId: membership.tenantId,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    tenantRole: toTenantRole(membership.role),
    permissions: coercePermissions(membership.permissions)
  }));
}

type SessionRecord = Prisma.PromiseReturnType<typeof getSessionRecord>;

async function getSessionRecord(sessionId: string) {
  return prisma.operatorSession.findUnique({
    where: { sessionId },
    include: {
      tenant: true,
      membership: true,
      user: true
    }
  });
}

function buildAuthenticatedSession(input: { session: NonNullable<SessionRecord>; memberships: SessionMembershipSummary[] }): AuthenticatedSession {
  const { session, memberships } = input;
  const globalRoles = coerceGlobalRoles(session.user.globalRoles);
  const currentMembership = session.membershipId
    ? memberships.find((membership) => membership.membershipId === session.membershipId)
    : undefined;
  const tenantRole = currentMembership?.tenantRole;
  const permissions = unionPermissions({
    globalRoles,
    tenantRole,
    permissions: currentMembership?.permissions ?? []
  });
  const authTime = Math.floor(session.authTime.getTime() / 1000);
  const amr = Array.isArray(session.amr) ? session.amr.filter((item): item is string => typeof item === "string") : [];

  return {
    userId: session.user.auth0UserId,
    email: session.email ?? session.user.email ?? undefined,
    displayName: session.displayName ?? session.user.displayName ?? undefined,
    sessionId: session.sessionId,
    auth0OrganizationId: session.auth0OrganizationId,
    tenantId: session.tenantId,
    tenantSlug: session.tenant.slug,
    tenantName: session.tenant.name,
    globalRoles,
    tenantRole,
    roles: unionRoles({ globalRoles, tenantRole }),
    permissions,
    memberships,
    authTime,
    amr,
    mfaFreshUntil: authTime + env.AUTH0_MFA_FRESHNESS_SECONDS
  };
}

async function persistOperatorSessionSelection(input: {
  sessionId: string;
  userId: string;
  tenantId: string;
  auth0OrganizationId: string;
  membershipId?: string | null;
  email?: string | null;
  displayName?: string | null;
  roles: AuthorizationRole[];
  permissions: OperatorPermission[];
  authTime: Date;
  amr: string[];
}) {
  await prisma.operatorSession.upsert({
    where: { sessionId: input.sessionId },
    create: {
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      membershipId: input.membershipId ?? null,
      userId: input.userId,
      auth0OrganizationId: input.auth0OrganizationId,
      email: input.email ?? null,
      displayName: input.displayName ?? null,
      roles: input.roles as unknown as Prisma.InputJsonValue,
      permissions: input.permissions as unknown as Prisma.InputJsonValue,
      authTime: input.authTime,
      amr: input.amr,
      lastSeenAt: new Date()
    },
    update: {
      tenantId: input.tenantId,
      membershipId: input.membershipId ?? null,
      userId: input.userId,
      auth0OrganizationId: input.auth0OrganizationId,
      email: input.email ?? null,
      displayName: input.displayName ?? null,
      roles: input.roles as unknown as Prisma.InputJsonValue,
      permissions: input.permissions as unknown as Prisma.InputJsonValue,
      authTime: input.authTime,
      amr: input.amr,
      lastSeenAt: new Date(),
      revokedAt: null
    }
  });
}

export async function validateIdToken(idToken: string, nonce?: string): Promise<OperatorIdentity> {
  const payload = await validateJwtToken(idToken, env.AUTH0_CLIENT_ID, { nonce });
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;

  if (!userId) {
    throw new Error("ID token is missing the subject claim");
  }

  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    displayName: typeof payload.name === "string" ? payload.name : undefined,
    authTime: typeof payload.auth_time === "number" ? payload.auth_time : payload.iat ?? Math.floor(Date.now() / 1000),
    amr: Array.isArray(payload.amr) ? payload.amr.filter((item): item is string => typeof item === "string") : []
  };
}

export async function createOperatorSession(identity: OperatorIdentity, organization?: string): Promise<AuthenticatedSession> {
  const selectedOrganization = organization ?? env.AUTH0_DEFAULT_ORGANIZATION;
  if (!selectedOrganization) {
    throw new Error("An Auth0 organization is required to create an operator session");
  }

  const authConnection = await resolveTenantAuthConnection(selectedOrganization);
  const user = await upsertUser(identity);
  const globalRoles = coerceGlobalRoles(user.globalRoles);
  const membership = await resolveMembershipForLogin(
    user.id,
    authConnection.tenantId,
    identity.email,
    identity.displayName,
    authConnection.auth0OrganizationId
  );

  if (!membership && !globalRoles.includes("superadmin")) {
    throw new Error("Authenticated user is not a member of the tenant");
  }

  const tenantRole = membership ? toTenantRole(membership.role) : undefined;
  const permissions = unionPermissions({
    globalRoles,
    tenantRole,
    permissions: membership ? coercePermissions(membership.permissions) : []
  });
  const sessionId = crypto.randomUUID();

  await persistOperatorSessionSelection({
    sessionId,
    tenantId: authConnection.tenantId,
    membershipId: membership?.id ?? null,
    userId: user.id,
    auth0OrganizationId: authConnection.auth0OrganizationId,
    email: identity.email ?? membership?.email ?? user.email,
    displayName: identity.displayName ?? membership?.displayName ?? user.displayName,
    roles: unionRoles({ globalRoles, tenantRole }),
    permissions,
    authTime: new Date(identity.authTime * 1000),
    amr: identity.amr
  });

  return authenticateOperatorSession(sessionId);
}

export async function switchOperatorTenant(sessionId: string, tenantIdOrSlug: string): Promise<AuthenticatedSession> {
  const existingSession = await getSessionRecord(sessionId);
  if (!existingSession || existingSession.revokedAt) {
    throw new Error("Session has been revoked");
  }

  if (!existingSession.user.active) {
    throw new Error("Authenticated user is inactive");
  }

  const tenant = await resolveTenantByIdOrSlug(tenantIdOrSlug);
  const memberships = await resolveUserMemberships(existingSession.userId);
  const membership = memberships.find((candidate) => candidate.tenantId === tenant.id);
  const globalRoles = coerceGlobalRoles(existingSession.user.globalRoles);

  if (!membership && !globalRoles.includes("superadmin")) {
    throw new Error("Authenticated user is not a member of the requested tenant");
  }

  const authConnection = await resolveTenantDefaultAuthConnection(tenant.id);
  const tenantRole = membership?.tenantRole;
  const permissions = unionPermissions({
    globalRoles,
    tenantRole,
    permissions: membership?.permissions ?? []
  });

  await persistOperatorSessionSelection({
    sessionId,
    tenantId: tenant.id,
    membershipId: membership?.membershipId ?? null,
    userId: existingSession.userId,
    auth0OrganizationId: authConnection.auth0OrganizationId,
    email: existingSession.email ?? existingSession.user.email,
    displayName: existingSession.displayName ?? existingSession.user.displayName,
    roles: unionRoles({ globalRoles, tenantRole }),
    permissions,
    authTime: existingSession.authTime,
    amr: Array.isArray(existingSession.amr) ? existingSession.amr.filter((item): item is string => typeof item === "string") : []
  });

  return authenticateOperatorSession(sessionId);
}

export async function authenticateOperatorSession(sessionId: string): Promise<AuthenticatedSession> {
  const session = await getSessionRecord(sessionId);

  if (!session || session.revokedAt) {
    throw new Error("Session has been revoked");
  }

  if (!session.user.active) {
    throw new Error("Authenticated user is inactive");
  }

  const memberships = await resolveUserMemberships(session.userId);
  const globalRoles = coerceGlobalRoles(session.user.globalRoles);
  const currentMembership = session.membershipId
    ? memberships.find((membership) => membership.membershipId === session.membershipId)
    : undefined;

  if (session.membershipId && !currentMembership) {
    throw new Error("Authenticated user is not a member of the tenant");
  }

  if (!currentMembership && !globalRoles.includes("superadmin")) {
    throw new Error("Authenticated user is not a member of the tenant");
  }

  await prisma.operatorSession.update({
    where: { sessionId },
    data: { lastSeenAt: new Date() }
  });

  return buildAuthenticatedSession({
    session,
    memberships
  });
}

export async function authenticateServiceToken(token: string): Promise<ServicePrincipalContext> {
  const payload = await validateJwtToken(token, env.AUTH0_AUDIENCE);
  const clientId = typeof payload.azp === "string" ? payload.azp : typeof payload.sub === "string" ? payload.sub : undefined;
  const tenantId = typeof payload[env.AUTH0_TENANT_CLAIM] === "string" ? (payload[env.AUTH0_TENANT_CLAIM] as string) : undefined;
  const permissions = coercePermissions(payload[env.AUTH0_PERMISSIONS_CLAIM]);

  if (!clientId || !tenantId) {
    throw new Error("Service token is missing required tenant claims");
  }

  return {
    clientId,
    tenantId,
    permissions
  };
}

export function hasPermission(session: AuthenticatedSession, permission: OperatorPermission) {
  return session.permissions.includes(permission);
}

export function hasFreshMfa(session: AuthenticatedSession) {
  return session.amr.includes("mfa") && session.mfaFreshUntil * 1000 > Date.now();
}

export function hasGlobalRole(session: AuthenticatedSession, role: GlobalRole) {
  return session.globalRoles.includes(role);
}

export function buildAuthorizeUrl(input: { state: string; nonce: string; codeChallenge: string; organization?: string; prompt?: string }) {
  const issuer = `https://${env.AUTH0_DOMAIN}`;
  const url = new URL(`${issuer}/authorize`);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.AUTH0_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.AUTH0_CALLBACK_URL);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);

  const organization = input.organization ?? env.AUTH0_DEFAULT_ORGANIZATION;
  if (organization) {
    url.searchParams.set("organization", organization);
  }

  if (env.AUTH0_DEFAULT_CONNECTION) {
    url.searchParams.set("connection", env.AUTH0_DEFAULT_CONNECTION);
  }

  if (input.prompt) {
    url.searchParams.set("prompt", input.prompt);
  }

  return url.toString();
}

export function createPkcePair() {
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = toBase64Url(crypto.randomBytes(16));
  const nonce = toBase64Url(crypto.randomBytes(16));
  return { codeVerifier, codeChallenge, state, nonce };
}
