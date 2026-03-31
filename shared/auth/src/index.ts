import crypto from "node:crypto";
import { env, prisma } from "@asp/config";
import { AuthenticatedSession, OPERATOR_PERMISSIONS, OPERATOR_ROLES, OperatorPermission, OperatorRole, ServicePrincipalContext } from "@asp/types";

type JwtPayload = Record<string, unknown> & {
  sub?: string;
  sid?: string;
  org_id?: string;
  org_name?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  auth_time?: number;
  amr?: string[];
  email?: string;
  name?: string;
};

function getStringClaim(payload: JwtPayload, ...claimNames: string[]) {
  for (const claimName of claimNames) {
    if (typeof payload[claimName] === "string") {
      return payload[claimName] as string;
    }
  }

  return undefined;
}

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

async function validateTokenSignature(token: string) {
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
  if (!audienceList.includes(env.AUTH0_AUDIENCE)) {
    throw new Error("Bearer token audience is invalid");
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    throw new Error("Bearer token is expired");
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

export function extractBearerToken(headers: Record<string, string | string[] | undefined>, cookies?: Record<string, string>) {
  const authorization = headers.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (headerValue?.startsWith("Bearer ")) {
    return headerValue.slice("Bearer ".length);
  }

  return cookies?.[env.SESSION_COOKIE_NAME];
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

export async function authenticateToken(token: string): Promise<AuthenticatedSession> {
  const payload = await validateTokenSignature(token);
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  const sessionId = typeof payload.sid === "string" ? payload.sid : undefined;
  const orgId = getStringClaim(payload, "org_id", "https://agentic-service-provider/org_id");
  const orgName = getStringClaim(payload, "org_name", "https://agentic-service-provider/org_name");
  const tenantClaim = getStringClaim(payload, env.AUTH0_TENANT_CLAIM);
  const defaultOrganization = env.AUTH0_DEFAULT_ORGANIZATION;
  const roles = coerceRoles(payload[env.AUTH0_ROLES_CLAIM]);
  const claimedPermissions = coercePermissions(payload[env.AUTH0_PERMISSIONS_CLAIM]);
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : payload.iat ?? Math.floor(Date.now() / 1000);
  const amr = Array.isArray(payload.amr) ? payload.amr.filter((item): item is string => typeof item === "string") : [];

  if (!userId || !sessionId || (!orgId && !orgName && !tenantClaim && !defaultOrganization)) {
    throw new Error("Bearer token is missing required Auth0 organization or tenant claims");
  }

  const authConnectionWhere = tenantClaim
    ? {
        tenant: {
          OR: [{ id: tenantClaim }, { slug: tenantClaim }]
        }
      }
    : defaultOrganization && !orgId && !orgName
      ? {
          OR: [{ auth0OrganizationId: defaultOrganization }, { auth0OrganizationName: defaultOrganization }]
        }
    : orgId && orgName
      ? {
          OR: [{ auth0OrganizationId: orgId }, { auth0OrganizationName: orgName }]
        }
      : orgId
        ? { auth0OrganizationId: orgId }
        : { auth0OrganizationName: orgName! };

  const authConnection = await prisma.tenantAuthConnection.findFirst({
    where: authConnectionWhere,
    include: { tenant: true }
  });

  if (!authConnection) {
    throw new Error("No tenant is mapped to the provided Auth0 organization");
  }

  const user = await prisma.user.upsert({
    where: { auth0UserId: userId },
    create: {
      auth0UserId: userId,
      email: typeof payload.email === "string" ? payload.email : null,
      displayName: typeof payload.name === "string" ? payload.name : null,
      globalRoles: []
    },
    update: {
      email: typeof payload.email === "string" ? payload.email : undefined,
      displayName: typeof payload.name === "string" ? payload.name : undefined
    }
  });

  if (!user.active) {
    throw new Error("Authenticated user is inactive");
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: authConnection.tenantId,
      userId: user.id,
      active: true
    }
  });

  if (!membership) {
    throw new Error("Authenticated user is not a member of the tenant");
  }

  const membershipRole = membership.role.toLowerCase() as OperatorRole;
  const mergedRoles = Array.from(new Set<OperatorRole>([membershipRole, ...roles]));
  const mergedPermissions = unionPermissions(
    mergedRoles,
    claimedPermissions.length ? claimedPermissions : (membership.permissions as OperatorPermission[] | undefined) ?? []
  );

  const revokedSession = await prisma.operatorSession.findUnique({
    where: { sessionId },
    select: { revokedAt: true }
  });

  if (revokedSession?.revokedAt) {
    throw new Error("Session has been revoked");
  }

  await prisma.operatorSession.upsert({
    where: { sessionId },
    create: {
      tenantId: authConnection.tenantId,
      membershipId: membership.id,
      userId: user.id,
      auth0OrganizationId: orgId ?? defaultOrganization ?? authConnection.auth0OrganizationId,
      sessionId,
      email: typeof payload.email === "string" ? payload.email : membership.email,
      displayName: typeof payload.name === "string" ? payload.name : membership.displayName,
      roles: mergedRoles,
      permissions: mergedPermissions,
      authTime: new Date(authTime * 1000),
      amr,
      lastSeenAt: new Date()
    },
    update: {
      membershipId: membership.id,
      userId: user.id,
      email: typeof payload.email === "string" ? payload.email : membership.email,
      displayName: typeof payload.name === "string" ? payload.name : membership.displayName,
      roles: mergedRoles,
      permissions: mergedPermissions,
      authTime: new Date(authTime * 1000),
      amr,
      lastSeenAt: new Date()
    }
  });

  return {
    userId,
    email: typeof payload.email === "string" ? payload.email : membership.email ?? undefined,
    displayName: typeof payload.name === "string" ? payload.name : membership.displayName ?? undefined,
    sessionId,
    auth0OrganizationId: orgId ?? defaultOrganization ?? authConnection.auth0OrganizationId,
    tenantId: authConnection.tenantId,
    tenantSlug: authConnection.tenant.slug,
    tenantName: authConnection.tenant.name,
    roles: mergedRoles,
    permissions: mergedPermissions,
    authTime,
    amr,
    mfaFreshUntil: authTime + env.AUTH0_MFA_FRESHNESS_SECONDS
  };
}

export async function authenticateServiceToken(token: string): Promise<ServicePrincipalContext> {
  const payload = await validateTokenSignature(token);
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
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("audience", env.AUTH0_AUDIENCE);
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
