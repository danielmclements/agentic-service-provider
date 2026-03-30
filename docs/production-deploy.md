# Production Deployment

This repo now includes a production-oriented Compose stack with:

- Caddy for HTTPS termination on `ops.danielclements.me` and `temporal.danielclements.me`
- private API, worker, Postgres, Temporal, and Temporal UI services
- JWKS-based Auth0 signing-key rotation for `RS256` access tokens
- file-backed secrets for sensitive config
- automated compressed Postgres backups
- proxy-aware application rate limiting
- IP filtering plus basic auth for Temporal UI

## Server Prerequisites

- Rocky Linux with Docker and Docker Compose
- DNS A records pointing both domains at the VM:
  - `ops.danielclements.me`
  - `temporal.danielclements.me`
- ports `80` and `443` open to the internet

## Files To Create On The Server

1. Copy the production env template:

```bash
cp .env.production.example .env.production
ln -sfn .env.production .env
```

2. Create the secrets directory and required secret files:

```bash
mkdir -p infra/docker/secrets
printf '%s' 'replace-with-postgres-password' > infra/docker/secrets/postgres_password.txt
printf '%s' 'postgresql://postgres:replace-with-postgres-password@postgres:5432/agentic_msp' > infra/docker/secrets/database_url.txt
printf '%s' 'replace-with-auth0-client-secret' > infra/docker/secrets/auth0_client_secret.txt
printf '%s' 'replace-with-openai-api-key-or-leave-empty' > infra/docker/secrets/openai_api_key.txt
chmod 600 infra/docker/secrets/*.txt
```

3. Update `.env.production`:

- `OPS_DOMAIN=ops.danielclements.me`
- `TEMPORAL_DOMAIN=temporal.danielclements.me`
- `CADDY_EMAIL=<email for LetsEncrypt notices>`
- `TEMPORAL_ALLOWED_CIDRS=<your public IP or office CIDR>`
- `TEMPORAL_BASICAUTH_USERNAME=<admin username>`
- `TEMPORAL_BASICAUTH_PASSWORD_HASH=<output of caddy hash-password>`
- `AUTH0_DOMAIN=<your Auth0 tenant>`
- `AUTH0_AUDIENCE=https://agentic-service-provider/api`
- `AUTH0_ISSUER=https://<your-tenant>/`
- `AUTH0_CLIENT_ID=<Auth0 Regular Web App client id>`
- `AUTH0_CALLBACK_URL=https://ops.danielclements.me/auth/callback`
- `AUTH0_LOGOUT_URL=https://ops.danielclements.me/operator`
- `AUTH0_DEFAULT_ORGANIZATION=acme`
- `AUTH0_JWT_ALGORITHMS=RS256`
- `AUTH0_JWKS_URL=https://<your-tenant>/.well-known/jwks.json`

Generate the Temporal UI password hash with:

```bash
docker run --rm caddy:2.9-alpine caddy hash-password --plaintext 'replace-me'
```

When you place that bcrypt hash into `.env.production` or the `PROD_ENV_FILE` GitHub secret, escape every `$` as `$$` so Docker Compose does not treat the hash as variable interpolation.

The `.env` symlink keeps plain `docker compose -f infra/docker/docker-compose.prod.yml ...` commands from warning about unset variables during interpolation. If you prefer not to use the symlink, pass `--env-file .env.production` on every production Compose command instead.

## Deploy

```bash
pnpm infra:prod:up
pnpm prisma:migrate
pnpm prisma:seed
pnpm infra:prod:ps
pnpm infra:prod:logs
```

## Public Endpoints

- Operator console: `https://ops.danielclements.me/operator`
- Health check: `https://ops.danielclements.me/health`
- Temporal UI: `https://temporal.danielclements.me`

## GitHub Actions Deployment

This repo now includes:

- [deploy-production.yml](/Users/danielclements/Documents/DevProjects/agentic-service-provider/.github/workflows/deploy-production.yml)
- [deploy-prod.sh](/Users/danielclements/Documents/DevProjects/agentic-service-provider/scripts/deploy-prod.sh)

Recommended GitHub Environment:

- `production`

Set this environment variable:

- `PROD_DEPLOY_PATH`
  - example: `/opt/agentic-service-provider`

Set these GitHub environment secrets:

- `PROD_SSH_HOST`
- `PROD_SSH_PORT`
- `PROD_SSH_USER`
- `PROD_SSH_PRIVATE_KEY`
- `PROD_SSH_KNOWN_HOSTS`
- `PROD_ENV_FILE`
- `PROD_DATABASE_URL`
- `PROD_POSTGRES_PASSWORD`
- `PROD_AUTH0_CLIENT_SECRET`
- `PROD_OPENAI_API_KEY`

`PROD_ENV_FILE` should contain the full contents of `.env.production`, based on:

- [`.env.production.example`](/Users/danielclements/Documents/DevProjects/agentic-service-provider/.env.production.example)

The workflow runs on every push to `main` and can also be triggered manually.

If you want seeds to run during a manual deploy, use the workflow input:

- `run_seed=true`

## Auth0 Console Changes

### 1. API / Resource Server

Create or update the API with:

- Identifier: `https://agentic-service-provider/api`
- RBAC: enabled
- Add Permissions in the Access Token: enabled

Required permissions:

- `tickets:read`
- `tickets:submit`
- `approvals:read`
- `approvals:decide`
- `audit:read`
- `connectors:admin`
- `tenants:admin`

### 2. Regular Web Application

In the Auth0 application settings, set:

- Allowed Callback URLs:
  - `https://ops.danielclements.me/auth/callback`
- Allowed Logout URLs:
  - `https://ops.danielclements.me/operator`
- Allowed Web Origins:
  - `https://ops.danielclements.me`

You can keep localhost values during rollout if you still want local testing.

### 3. Organization

Use the organization slug:

- `acme`

Make sure Daniel is a member of that organization and has the right org role.

### 4. Roles

Create Auth0 roles that match the app roles:

- `tenant_viewer`
- `tenant_operator`
- `tenant_approver`
- `tenant_admin`
- `platform_admin`

At minimum for Daniel:

- `tenant_admin`

### 5. Post-Login Action

Add a Post-Login Action that copies Auth0 org roles into the access token claim expected by the app:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://agentic-service-provider';
  const roles = event.authorization?.roles || [];
  api.accessToken.setCustomClaim(`${namespace}/roles`, roles);
};
```

The API already reads permissions from the standard `permissions` claim, so no custom Action is needed for that if RBAC and `Add Permissions in the Access Token` are enabled.

### 6. MFA

Enable MFA for operator login. Approval decisions require fresh MFA within the configured window:

- `AUTH0_MFA_FRESHNESS_SECONDS=300`

### 7. Service-to-Service Follow-On

When you move real integrations onto Auth0 client credentials, add a Machine-to-Machine / Credentials Exchange Action to emit:

- `https://agentic-service-provider/tenant_id`

The current API expects that claim on service tokens.

## Notes

- JWKS rotation is now preferred over static `AUTH0_JWT_PUBLIC_KEY`.
- `AUTH0_JWT_PUBLIC_KEY` still works as a fallback if needed during an incident.
- Postgres backups are written to the `backups-data` Docker volume as compressed `.sql.gz` dumps.
- Temporal UI is protected by both Caddy basic auth and an IP allowlist.
