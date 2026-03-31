import { env, prisma } from "@asp/config";
import { ActionType, PolicyDecision } from "@prisma/client";

async function seed() {
  const auth0OrganizationId = env.AUTH0_DEFAULT_ORGANIZATION ?? "org_acme";
  const auth0OrganizationName = "acme";

  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      slug: "acme",
      name: "Acme Corp",
      identityProvider: "MOCK",
      policy: {
        create: {
          allowedActions: [ActionType.RESET_PASSWORD, ActionType.UNLOCK_ACCOUNT, ActionType.ADD_TO_GROUP],
          approvalRules: {
            ADD_TO_GROUP: PolicyDecision.REQUIRES_APPROVAL,
            DISABLE_MFA: PolicyDecision.BLOCK
          },
          verificationSettings: {
            requiredActions: [ActionType.RESET_PASSWORD, ActionType.ADD_TO_GROUP],
            primaryMethod: "PUSH",
            allowSmsFallback: true,
            requireManualReviewOnMissingFactor: true,
            challengeTtlMinutes: 10
          },
          modelSettings: {
            provider: "heuristic",
            modelName: "local-heuristic"
          }
        }
      }
    }
  });

  const operatorAdminUser = await prisma.user.upsert({
    where: { auth0UserId: "auth0|operator-admin" },
    update: {
      email: "operator@acme.com",
      displayName: "Acme Operator",
      active: true
    },
    create: {
      auth0UserId: "auth0|operator-admin",
      email: "operator@acme.com",
      displayName: "Acme Operator",
      globalRoles: []
    }
  });

  const danielUser = await prisma.user.upsert({
    where: { auth0UserId: "auth0|daniel.clements" },
    update: {
      email: "daniel.clements@acme.com",
      displayName: "Daniel Clements",
      active: true
    },
    create: {
      auth0UserId: "auth0|daniel.clements",
      email: "daniel.clements@acme.com",
      displayName: "Daniel Clements",
      globalRoles: []
    }
  });

  await prisma.tenantAuthConnection.upsert({
    where: { auth0OrganizationId },
    update: {
      auth0OrganizationName
    },
    create: {
      tenantId: tenant.id,
      auth0OrganizationId,
      auth0OrganizationName,
      displayName: "Acme Workforce",
      strategy: "OIDC",
      connectionName: "acme-entra",
      issuer: "https://login.microsoftonline.com/mock-tenant/v2.0"
    }
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: operatorAdminUser.id
      }
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: operatorAdminUser.id,
      auth0OrgId: auth0OrganizationId,
      email: "operator@acme.com",
      displayName: "Acme Operator",
      role: "TENANT_ADMIN",
      permissions: [
        "tickets:read",
        "tickets:submit",
        "approvals:read",
        "approvals:decide",
        "audit:read",
        "connectors:admin",
        "tenants:admin"
      ]
    }
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: danielUser.id
      }
    },
    update: {
      email: "daniel.clements@acme.com",
      displayName: "Daniel Clements",
      auth0OrgId: auth0OrganizationId,
      role: "TENANT_ADMIN",
      permissions: [
        "tickets:read",
        "tickets:submit",
        "approvals:read",
        "approvals:decide",
        "audit:read",
        "connectors:admin",
        "tenants:admin"
      ],
      active: true
    },
    create: {
      tenantId: tenant.id,
      userId: danielUser.id,
      auth0OrgId: auth0OrganizationId,
      email: "daniel.clements@acme.com",
      displayName: "Daniel Clements",
      role: "TENANT_ADMIN",
      permissions: [
        "tickets:read",
        "tickets:submit",
        "approvals:read",
        "approvals:decide",
        "audit:read",
        "connectors:admin",
        "tenants:admin"
      ]
    }
  });

  await prisma.tenantConnectorConfig.upsert({
    where: {
      tenantId_provider: {
        tenantId: tenant.id,
        provider: "M365"
      }
    },
    update: {},
    create: {
      tenantId: tenant.id,
      provider: "M365",
      entraTenantId: "00000000-0000-0000-0000-000000000000",
      clientId: "m365-client-id",
      clientSecretVaultRef: "vault://acme/m365/client-secret",
      allowedGraphScopes: ["User.ReadWrite.All", "GroupMember.ReadWrite.All"],
      allowedTargetGroups: ["finance", "general-access"]
    }
  });
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
