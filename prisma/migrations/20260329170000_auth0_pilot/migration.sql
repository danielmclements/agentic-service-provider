-- Extend enums
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'WAITING_VERIFICATION';
ALTER TYPE "ActionStatus" ADD VALUE IF NOT EXISTS 'WAITING_VERIFICATION';
ALTER TYPE "ExecutionRunStatus" ADD VALUE IF NOT EXISTS 'WAITING_VERIFICATION';

-- CreateEnum
CREATE TYPE "OperatorRole" AS ENUM ('TENANT_VIEWER', 'TENANT_OPERATOR', 'TENANT_APPROVER', 'TENANT_ADMIN', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "AuthConnectionStrategy" AS ENUM ('AUTH0_DATABASE', 'OIDC', 'SAML');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('PUSH', 'WEBAUTHN', 'SMS', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'BYPASSED');

-- AlterTable
ALTER TABLE "TenantPolicy" ADD COLUMN "verificationSettings" JSONB;

-- AlterTable
ALTER TABLE "AuditLog"
  ADD COLUMN "actorDisplayName" TEXT,
  ADD COLUMN "actorOrgId" TEXT,
  ADD COLUMN "actorSessionId" TEXT,
  ADD COLUMN "actorSubject" TEXT;

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auth0UserId" TEXT NOT NULL,
    "auth0OrgId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "role" "OperatorRole" NOT NULL,
    "permissions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAuthConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auth0OrganizationId" TEXT NOT NULL,
    "auth0OrganizationName" TEXT,
    "displayName" TEXT NOT NULL,
    "strategy" "AuthConnectionStrategy" NOT NULL,
    "connectionName" TEXT NOT NULL,
    "issuer" TEXT,
    "clientId" TEXT,
    "metadata" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAuthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "auth0UserId" TEXT NOT NULL,
    "auth0OrganizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "roles" JSONB NOT NULL,
    "permissions" JSONB NOT NULL,
    "authTime" TIMESTAMP(3) NOT NULL,
    "amr" JSONB NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL,
    "actionRequestId" TEXT NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "targetReference" TEXT NOT NULL,
    "evidencePayload" JSONB,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantConnectorConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "entraTenantId" TEXT,
    "clientId" TEXT,
    "clientSecretVaultRef" TEXT,
    "clientCertVaultRef" TEXT,
    "allowedGraphScopes" JSONB NOT NULL,
    "allowedTargetGroups" JSONB NOT NULL,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantConnectorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_auth0UserId_key" ON "TenantMembership"("tenantId", "auth0UserId");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_auth0OrgId_idx" ON "TenantMembership"("tenantId", "auth0OrgId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAuthConnection_auth0OrganizationId_key" ON "TenantAuthConnection"("auth0OrganizationId");

-- CreateIndex
CREATE INDEX "TenantAuthConnection_tenantId_isDefault_idx" ON "TenantAuthConnection"("tenantId", "isDefault");

-- CreateIndex
CREATE INDEX "TenantAuthConnection_auth0OrganizationName_idx" ON "TenantAuthConnection"("auth0OrganizationName");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorSession_sessionId_key" ON "OperatorSession"("sessionId");

-- CreateIndex
CREATE INDEX "OperatorSession_tenantId_auth0UserId_idx" ON "OperatorSession"("tenantId", "auth0UserId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_actionRequestId_key" ON "VerificationChallenge"("actionRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantConnectorConfig_tenantId_provider_key" ON "TenantConnectorConfig"("tenantId", "provider");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAuthConnection" ADD CONSTRAINT "TenantAuthConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "TenantMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "ActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantConnectorConfig" ADD CONSTRAINT "TenantConnectorConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
