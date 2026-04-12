import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { env, prisma } from "@asp/config";
import { AuthenticatedSession, OPERATOR_PERMISSIONS, OPERATOR_ROLES, OperatorPermission, OperatorRole, ServicePrincipalContext } from "@asp/types";

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

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map<string, { publicKey: string; expiresAt: number }>();

const rolePermissions: Record<OperatorRole, OperatorPermission[]> = {
  tenant_viewer: ["tickets:read", "approvals:read", "audit:read"],
  tenant_operator: ["tickets:read", "tickets:submit", "approvals:read", "audit:read"],
  tenant_approver: ["tickets:read", "approvals:read", "approvals:decide", "audit:read"],
  tenant_admin: ["tickets:read", "tickets:submit", "approvals:read", "approvals:decide", "audit:read", "connectors:admin", "tenants:admin"],
  platform_admin: ["tickets:read", "tickets:submit", "approvals:read", "approvals:decide", "audit:read", "connectors:admin", "tenants:admin"]
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

function coerceRoles(input: unknown): OperatorRole[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((role): role is OperatorRole => typeof role === "string" && (OPERATOR_ROLES as readonly string[]).includes(role));
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

function unionPermissions(roles: OperatorRole[], permissions: OperatorPermission[]) {
  const combined = new Set<OperatorPermission>(permissions);
  for (const role of roles) {
    for (const permission of rolePermissions[role] ?? []) {
      combined.add(permission);
    }
  }

  return [...combined];
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

  // Transitional bootstrap for pre-existing seeded memberships that were created before real Auth0 user IDs were known.
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

  if (!membership) {
    throw new Error("Authenticated user is not a member of the tenant");
  }

  return membership;
}

function buildAuthenticatedSession(input: {
  sessionId: string;
  auth0OrganizationId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  authTime: Date;
  amr: unknown;
  userId: string;
  email?: string | null;
  displayName?: string | null;
  membershipRole: string;
  membershipPermissions: unknown;
}) {
  const roles = [input.membershipRole.toLowerCase() as OperatorRole];
  const permissions = unionPermissions(roles, coercePermissions(input.membershipPermissions));
  const authTime = Math.floor(input.authTime.getTime() / 1000);
  const amr = Array.isArray(input.amr) ? input.amr.filter((item): item is string => typeof item === "string") : [];

  return {
    userId: input.userId,
    email: input.email ?? undefined,
    displayName: input.displayName ?? undefined,
    sessionId: input.sessionId,
    auth0OrganizationId: input.auth0OrganizationId,
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantName: input.tenantName,
    roles,
    permissions,
    authTime,
    amr,
    mfaFreshUntil: authTime + env.AUTH0_MFA_FRESHNESS_SECONDS
  } satisfies AuthenticatedSession;
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
  const membership = await resolveMembershipForLogin(
    user.id,
    authConnection.tenantId,
    identity.email,
    identity.displayName,
    authConnection.auth0OrganizationId
  );

  const sessionId = crypto.randomUUID();
  await prisma.operatorSession.create({
    data: {
      tenantId: authConnection.tenantId,
      membershipId: membership.id,
      userId: user.id,
      auth0OrganizationId: authConnection.auth0OrganizationId,
      sessionId,
      email: identity.email ?? membership.email,
      displayName: identity.displayName ?? membership.displayName,
      roles: [membership.role.toLowerCase()],
      permissions: membership.permissions as Prisma.InputJsonValue,
      authTime: new Date(identity.authTime * 1000),
      amr: identity.amr,
      lastSeenAt: new Date()
    }
  });

  const persistedSession = await prisma.operatorSession.findUniqueOrThrow({
    where: { sessionId },
    include: {
      tenant: true,
      membership: true
    }
  });

  return buildAuthenticatedSession({
    sessionId: persistedSession.sessionId,
    auth0OrganizationId: persistedSession.auth0OrganizationId,
    tenantId: persistedSession.tenantId,
    tenantSlug: persistedSession.tenant.slug,
    tenantName: persistedSession.tenant.name,
    authTime: persistedSession.authTime,
    amr: persistedSession.amr,
    userId: user.auth0UserId,
    email: persistedSession.email,
    displayName: persistedSession.displayName,
    membershipRole: persistedSession.membership.role,
    membershipPermissions: persistedSession.membership.permissions
  });
}

export async function authenticateOperatorSession(sessionId: string): Promise<AuthenticatedSession> {
  const session = await prisma.operatorSession.findUnique({
    where: { sessionId },
    include: {
      tenant: true,
      membership: {
        include: {
          user: true
        }
      }
    }
  });

  if (!session || session.revokedAt) {
    throw new Error("Session has been revoked");
  }

  if (!session.membership.active) {
    throw new Error("Authenticated user is not a member of the tenant");
  }

  if (!session.membership.user.active) {
    throw new Error("Authenticated user is inactive");
  }

  await prisma.operatorSession.update({
    where: { sessionId },
    data: { lastSeenAt: new Date() }
  });

  return buildAuthenticatedSession({
    sessionId: session.sessionId,
    auth0OrganizationId: session.auth0OrganizationId,
    tenantId: session.tenantId,
    tenantSlug: session.tenant.slug,
    tenantName: session.tenant.name,
    authTime: session.authTime,
    amr: session.amr,
    userId: session.membership.user.auth0UserId,
    email: session.email ?? session.membership.email,
    displayName: session.displayName ?? session.membership.displayName,
    membershipRole: session.membership.role,
    membershipPermissions: session.membership.permissions
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
