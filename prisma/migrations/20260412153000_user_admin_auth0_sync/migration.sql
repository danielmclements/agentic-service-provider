CREATE TYPE "UserProvisioningStatus" AS ENUM ('LOCAL_ONLY', 'PROVISIONED', 'INVITED', 'ERROR');

ALTER TABLE "User"
  ADD COLUMN "provisioningStatus" "UserProvisioningStatus" NOT NULL DEFAULT 'LOCAL_ONLY',
  ADD COLUMN "invitedAt" TIMESTAMP(3),
  ADD COLUMN "lastAuth0SyncAt" TIMESTAMP(3),
  ADD COLUMN "lastAuth0SyncError" TEXT;

UPDATE "User"
SET
  "provisioningStatus" = CASE
    WHEN "active" = false THEN 'ERROR'::"UserProvisioningStatus"
    ELSE 'PROVISIONED'::"UserProvisioningStatus"
  END,
  "lastAuth0SyncAt" = NOW();
