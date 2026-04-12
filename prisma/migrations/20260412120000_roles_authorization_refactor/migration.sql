-- Promote legacy platform admins to the new global superadmin role.
UPDATE "User" AS u
SET "globalRoles" = CASE
  WHEN COALESCE(u."globalRoles", '[]'::jsonb) @> '["superadmin"]'::jsonb THEN COALESCE(u."globalRoles", '[]'::jsonb)
  ELSE COALESCE(u."globalRoles", '[]'::jsonb) || '["superadmin"]'::jsonb
END
WHERE EXISTS (
  SELECT 1
  FROM "TenantMembership" AS membership
  WHERE membership."userId" = u."id"
    AND membership."role" = 'PLATFORM_ADMIN'
);

CREATE TYPE "TenantRole" AS ENUM ('TENANT_ADMIN', 'TENANT_OPERATOR', 'TENANT_END_USER');

ALTER TABLE "TenantMembership" ADD COLUMN "role_new" "TenantRole";

UPDATE "TenantMembership"
SET "role_new" = CASE "role"
  WHEN 'TENANT_ADMIN' THEN 'TENANT_ADMIN'::"TenantRole"
  WHEN 'TENANT_OPERATOR' THEN 'TENANT_OPERATOR'::"TenantRole"
  WHEN 'TENANT_VIEWER' THEN 'TENANT_OPERATOR'::"TenantRole"
  WHEN 'TENANT_APPROVER' THEN 'TENANT_OPERATOR'::"TenantRole"
  WHEN 'PLATFORM_ADMIN' THEN 'TENANT_ADMIN'::"TenantRole"
END;

ALTER TABLE "TenantMembership" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "TenantMembership" DROP COLUMN "role";
ALTER TABLE "TenantMembership" RENAME COLUMN "role_new" TO "role";

DROP TYPE "OperatorRole";

ALTER TABLE "OperatorSession" ALTER COLUMN "membershipId" DROP NOT NULL;
