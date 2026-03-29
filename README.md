# Agentic Service Provider

Governed, multi-tenant AI service execution for IT helpdesk workflows. This MVP focuses on identity operations: password resets, account unlocks, group membership requests, and policy-gated approvals.

The current auth model is Auth0-first:

- operators authenticate through Auth0-backed browser sessions
- operator tenant scope is derived from Auth0 organization membership
- service-to-service ticket ingestion uses bearer tokens with tenant claims instead of static API keys
- risky actions can pause on end-user verification before approval or execution

## What You Can Run

- `api-server`: accepts tickets, exposes ticket, approval, and audit APIs
- `operator console`: browser UI for tickets, approvals, audit inspection, and business metrics
- `worker`: runs the Temporal workflow that performs triage, policy checks, approvals, and execution
- `postgres + temporal`: local infrastructure for persistence and orchestration
- `mock identity provider`: safe execution path for local testing

## Prerequisites

- Node.js 25+
- `pnpm`
- Docker Desktop with `docker compose`

The stack has now been booted and smoke-tested locally with Docker.

## Quick Start

1. Copy the env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
pnpm install
```

3. Start and bootstrap the full local stack:

```bash
pnpm bootstrap:local
```

This now boots:

- Postgres
- Temporal
- Temporal UI
- API server
- Temporal worker

4. Confirm the API is reachable:

```bash
curl http://localhost:4000/health
```

You should get:

```bash
{"status":"ok"}
```

The seeded tenant slug is `acme`. You can use `acme` directly in API requests.
Temporal UI is available at `http://localhost:8080`.
The operator console is available at `http://localhost:4000/operator`.

You can also open the API landing page at `http://localhost:4000/` to see the local endpoints.

## Production / Pilot Deploy

For a real-domain deployment on Docker with Caddy, Auth0 `RS256` + JWKS validation, file-backed secrets, Postgres backups, and hardened domain/callback settings, use:

- [production-deploy.md](/Users/danielclements/Documents/DevProjects/agentic-service-provider/docs/production-deploy.md)

## Operator Console

The fastest way to experience the MVP as a product is through the operator console:

- live business-case metrics
- pending approvals with approve and reject actions
- recent tickets with state and policy context
- per-ticket audit trail inspection
- built-in ticket submission for local scenarios

Open:

```bash
http://localhost:4000/operator
```

The operator console now relies on the server session:

- sign in through `/auth/login`
- the UI derives tenant, permissions, and MFA freshness from `/api/session`
- there are no browser-stored API keys or operator keys

## Optional: Run API and Worker Outside Docker

If you prefer to keep only Postgres and Temporal in containers:

```bash
pnpm infra:up
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev:api
pnpm dev:worker
```

## Default Local Auth Configuration

- default tenant slug: `acme`
- default Auth0 organization name: `acme`
- local callback URL: `http://localhost:4000/auth/callback`
- session cookie name: `asp_operator_session`
- local JWT secret for dev tokens: `AUTH0_JWT_SECRET`

For local-only testing without a live Auth0 login, you can mint a development bearer token:

```bash
pnpm auth:token:daniel
```

This prints an `HS256` token for the seeded Acme operator:

- name: `Daniel Clements`
- email: `daniel.clements@acme.com`
- Auth0 subject: `auth0|daniel.clements`
- Auth0 organization name: `acme`

Use it as:

```bash
TOKEN=$(pnpm -s auth:token:daniel)
curl http://localhost:4000/api/session -H "Authorization: Bearer $TOKEN"
```

## Basic Flow

1. Create a ticket
2. Worker triages it
3. Policy engine decides:
   auto-execute for low risk,
   approval for medium risk,
   block for high risk
4. Execution and all decisions are logged to the audit trail

## Test It

### 1. Submit a low-risk ticket

```bash
curl -X POST http://localhost:4000/api/tickets \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key" \
  -H "idempotency-key: demo-reset-1" \
  -d '{
    "tenant_id": "acme",
    "user_email": "user@acme.com",
    "message": "I am locked out of my account"
  }'
```

This should create a ticket and start a workflow. The worker should triage it as `UNLOCK_ACCOUNT` and auto-execute it.

### 2. List tickets

```bash
curl http://localhost:4000/api/tickets \
  -H "x-api-key: dev-api-key" \
  -H "x-tenant-id: acme"
```

### 3. Submit an approval-gated ticket

```bash
curl -X POST http://localhost:4000/api/tickets \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key" \
  -H "idempotency-key: demo-group-1" \
  -d '{
    "tenant_id": "acme",
    "user_email": "user@acme.com",
    "message": "Please add me to the finance group"
  }'
```

This should pause in `WAITING_APPROVAL`.

### 4. List approvals

```bash
curl http://localhost:4000/api/approvals \
  -H "x-operator-key: dev-operator-key" \
  -H "x-tenant-id: acme"
```

### 5. Approve a pending approval

Replace `APPROVAL_ID` with the ID returned by the approvals endpoint.

```bash
curl -X POST http://localhost:4000/api/approvals/APPROVAL_ID/decision \
  -H "Content-Type: application/json" \
  -H "x-operator-key: dev-operator-key" \
  -H "x-tenant-id: acme" \
  -d '{
    "decision": "approve",
    "reviewerIdentity": "Daniel Clements",
    "comment": "Approved for local test"
  }'
```

### 6. Fetch the audit trail

Replace `TICKET_ID` with a real ticket ID.

```bash
curl http://localhost:4000/api/audit/TICKET_ID \
  -H "x-api-key: dev-api-key" \
  -H "x-tenant-id: acme"
```

### 7. Get the operator summary

This is the fastest way to understand what the platform is doing right now without stitching together multiple API calls.

```bash
curl http://localhost:4000/api/operator-summary \
  -H "x-operator-key: dev-operator-key" \
  -H "x-tenant-id: acme"
```

### 8. Get business-case metrics

This endpoint translates the current tenant activity into the metrics that matter for an MSP or internal IT buyer:

- automation rate
- approval rate
- blocked rate
- success rate
- average resolution time
- action mix

```bash
curl http://localhost:4000/api/business-metrics \
  -H "x-operator-key: dev-operator-key" \
  -H "x-tenant-id: acme"
```

## MVP Demo Flow

Use this order when you want to test the product and the business case together:

1. Submit a low-risk unlock or password-reset request.
2. Confirm it reaches `RESOLVED` without human intervention.
3. Submit an `ADD_TO_GROUP` request and confirm it pauses in `WAITING_APPROVAL`.
4. Approve the request and confirm it resumes to `RESOLVED`.
5. Review the audit trail for both tickets.
6. Check `/api/operator-summary` to see the queue and recent outcomes.
7. Check `/api/business-metrics` to see the current automation and safety story.

## What Good Looks Like

For a strong MVP demo, you want to see:

- low-risk tickets moving straight to `RESOLVED`
- medium-risk tickets pausing for approval instead of executing immediately
- zero unsafe actions executing
- a complete audit trail for every ticket
- automation rate rising as repetitive requests are handled without operator effort
- average resolution time lower than a manual helpdesk baseline

This is the core business case for the platform: faster identity support, fewer manual touches, and safer execution with provable controls.

## Useful Commands

```bash
pnpm bootstrap:local
pnpm smoke:approval
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs -f api worker temporal postgres
docker compose -f infra/docker/docker-compose.yml up -d --build
docker compose -f infra/docker/docker-compose.yml down -v
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:migrate:dev
pnpm prisma:seed
pnpm test
pnpm lint
pnpm build
pnpm infra:down
```

## Notes

- If `OPENAI_API_KEY` is not set, triage falls back to a local heuristic classifier.
- `DISABLE_MFA` is intentionally blocked in the MVP.
- The M365 integration is stubbed; local execution uses the mock identity provider.
- If Docker was installed with Homebrew only, you may still need Docker Desktop or another Docker engine running before `docker compose` will work.
- The approval smoke test creates a live `ADD_TO_GROUP` request, approves it, and verifies audit events.
