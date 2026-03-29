# Agentic Service Provider

Governed, multi-tenant AI service execution for IT helpdesk workflows. This MVP focuses on identity operations: password resets, account unlocks, group membership requests, and policy-gated approvals.

## What You Can Run

- `api-server`: accepts tickets, exposes ticket, approval, and audit APIs
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

## Default Local Secrets

- API key: `dev-api-key`
- Operator API key: `dev-operator-key`
- Tenant slug: `acme`
- API base URL: `http://localhost:4000`

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
