import crypto from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv();

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const auth0Domain = process.env.AUTH0_DOMAIN ?? "example.us.auth0.com";
const auth0Audience = process.env.AUTH0_AUDIENCE ?? "https://agentic-service-provider/api";
const auth0Issuer = process.env.AUTH0_ISSUER ?? `https://${auth0Domain}/`;
const jwtSecret = process.env.AUTH0_JWT_SECRET ?? "dev-auth0-secret";
const rolesClaim = process.env.AUTH0_ROLES_CLAIM ?? "https://agentic-service-provider/roles";
const tenantClaim = process.env.AUTH0_TENANT_CLAIM ?? "https://agentic-service-provider/tenant_id";
const permissionsClaim = process.env.AUTH0_PERMISSIONS_CLAIM ?? "permissions";

const email = process.argv[2] ?? "daniel.clements@acme.com";
const displayName = process.argv[3] ?? "Daniel Clements";
const sub = process.argv[4] ?? "auth0|daniel.clements";
const orgId = process.argv[5] ?? "org_acme";
const orgName = process.argv[8] ?? "acme";
const tenantId = process.argv[6] ?? "tenant-1";
const sessionId = process.argv[7] ?? "sid-daniel-clements-local";
const now = Math.floor(Date.now() / 1000);

const header = {
  alg: "HS256",
  typ: "JWT"
};

const payload = {
  iss: auth0Issuer,
  aud: auth0Audience,
  sub,
  sid: sessionId,
  org_id: orgId,
  org_name: orgName,
  iat: now,
  exp: now + 8 * 60 * 60,
  auth_time: now,
  amr: ["pwd", "mfa"],
  email,
  name: displayName,
  [rolesClaim]: ["tenant_admin"],
  [permissionsClaim]: [
    "tickets:read",
    "tickets:submit",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "connectors:admin",
    "tenants:admin"
  ],
  [tenantClaim]: tenantId
};

const encodedHeader = toBase64Url(JSON.stringify(header));
const encodedPayload = toBase64Url(JSON.stringify(payload));
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = toBase64Url(crypto.createHmac("sha256", jwtSecret).update(signingInput).digest());
const token = `${signingInput}.${signature}`;

console.log(token);
