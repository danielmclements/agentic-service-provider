-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('MOCK', 'M365');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('RECEIVED', 'TRIAGED', 'WAITING_APPROVAL', 'EXECUTING', 'RESOLVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('RESET_PASSWORD', 'UNLOCK_ACCOUNT', 'ADD_TO_GROUP', 'DISABLE_MFA');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('AUTO_EXECUTE', 'REQUIRES_APPROVAL', 'BLOCK');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'BLOCKED', 'EXECUTING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExecutionRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'WAITING_APPROVAL');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identityProvider" "IdentityProvider" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "allowedActions" JSONB NOT NULL,
    "approvalRules" JSONB NOT NULL,
    "modelSettings" JSONB NOT NULL,

    CONSTRAINT "TenantPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "normalizedMessage" TEXT NOT NULL,
    "metadata" JSONB,
    "externalTicketRef" TEXT,
    "idempotencyKey" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'RECEIVED',
    "triageCategory" TEXT,
    "triageIntent" TEXT,
    "triageConfidence" DOUBLE PRECISION,
    "triageAction" "ActionType",
    "triageRationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "policyDecision" "PolicyDecision" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "inputPayload" JSONB NOT NULL,
    "outputPayload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actionRequestId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerIdentity" TEXT,
    "reviewerComment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT,
    "actionRequestId" TEXT,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "approvedBy" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionRun" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "ExecutionRunStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPolicy_tenantId_key" ON "TenantPolicy"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_tenantId_idempotencyKey_key" ON "Ticket"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_actionRequestId_key" ON "Approval"("actionRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRun_workflowId_key" ON "ExecutionRun"("workflowId");

-- AddForeignKey
ALTER TABLE "TenantPolicy" ADD CONSTRAINT "TenantPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "ActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "ActionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionRun" ADD CONSTRAINT "ExecutionRun_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
