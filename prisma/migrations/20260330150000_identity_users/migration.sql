-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "auth0UserId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "globalRoles" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_auth0UserId_key" ON "User"("auth0UserId");

-- Seed users from existing tenant memberships
INSERT INTO "User" ("id", "auth0UserId", "email", "displayName", "globalRoles", "active", "createdAt", "updatedAt")
SELECT DISTINCT ON ("auth0UserId")
    CONCAT('user_', md5("auth0UserId")) AS "id",
    "auth0UserId",
    "email",
    "displayName",
    '[]'::jsonb AS "globalRoles",
    true AS "active",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "TenantMembership"
WHERE "auth0UserId" IS NOT NULL
ORDER BY "auth0UserId", "updatedAt" DESC, "createdAt" DESC;

-- Backfill sessions that may exist without a membership row
INSERT INTO "User" ("id", "auth0UserId", "email", "displayName", "globalRoles", "active", "createdAt", "updatedAt")
SELECT DISTINCT ON ("auth0UserId")
    CONCAT('user_', md5("auth0UserId")) AS "id",
    "auth0UserId",
    "email",
    "displayName",
    '[]'::jsonb AS "globalRoles",
    true AS "active",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "OperatorSession"
WHERE "auth0UserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "User"
    WHERE "User"."auth0UserId" = "OperatorSession"."auth0UserId"
  )
ORDER BY "auth0UserId", "updatedAt" DESC, "createdAt" DESC;

-- AlterTable
ALTER TABLE "TenantMembership" ADD COLUMN "userId" TEXT;

-- AlterTable
ALTER TABLE "OperatorSession" ADD COLUMN "userId" TEXT;

-- Backfill foreign keys
UPDATE "TenantMembership" AS membership
SET "userId" = "User"."id"
FROM "User"
WHERE membership."auth0UserId" = "User"."auth0UserId";

UPDATE "OperatorSession" AS session
SET "userId" = "User"."id"
FROM "User"
WHERE session."auth0UserId" = "User"."auth0UserId";

-- Enforce new relations
ALTER TABLE "TenantMembership" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "OperatorSession" ALTER COLUMN "userId" SET NOT NULL;

-- DropIndex
DROP INDEX "TenantMembership_tenantId_auth0UserId_key";

-- DropIndex
DROP INDEX "OperatorSession_tenantId_auth0UserId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "OperatorSession_tenantId_userId_idx" ON "OperatorSession"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop legacy denormalized identifiers once backfill is complete
ALTER TABLE "TenantMembership" DROP COLUMN "auth0UserId";
ALTER TABLE "OperatorSession" DROP COLUMN "auth0UserId";
