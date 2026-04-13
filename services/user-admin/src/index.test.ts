import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindFirst: vi.fn(),
  tenantAuthConnectionFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  userUpsert: vi.fn(),
  userUpdate: vi.fn(),
  membershipUpsert: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipUpdateMany: vi.fn(async () => ({ count: 1 })),
  operatorSessionUpdateMany: vi.fn(async () => ({ count: 1 })),
  auditLog: vi.fn(async () => undefined)
}));

vi.mock("@asp/config", () => ({
  env: {
    AUTH0_DOMAIN: "example.us.auth0.com",
    AUTH0_CLIENT_ID: "operator-console",
    AUTH0_LOGOUT_URL: "http://localhost:4000/operator",
    AUTH0_MANAGEMENT_CLIENT_ID: "mgmt-client",
    AUTH0_MANAGEMENT_CLIENT_SECRET: "mgmt-secret",
    AUTH0_PROVISIONING_CONNECTION: "Username-Password-Authentication",
    AUTH0_JWT_ALGORITHMS: "HS256",
    AUTH0_PERMISSIONS_CLAIM: "permissions",
    AUTH0_TENANT_CLAIM: "https://agentic-service-provider/tenant_id",
    AUTH0_MFA_FRESHNESS_SECONDS: 300
  },
  prisma: {
    tenant: {
      findFirst: mocks.tenantFindFirst
    },
    tenantAuthConnection: {
      findFirst: mocks.tenantAuthConnectionFindFirst
    },
    user: {
      findMany: mocks.userFindMany,
      findUnique: mocks.userFindUnique,
      upsert: mocks.userUpsert,
      update: mocks.userUpdate
    },
    tenantMembership: {
      upsert: mocks.membershipUpsert,
      findUnique: mocks.membershipFindUnique,
      updateMany: mocks.membershipUpdateMany
    },
    operatorSession: {
      updateMany: mocks.operatorSessionUpdateMany
    }
  }
}));

vi.mock("@asp/audit-log", () => ({
  AuditLogService: class {
    log = mocks.auditLog;
  }
}));

import { UserAdminService } from "./index";

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    auth0UserId: "auth0|user-1",
    email: "managed@example.com",
    displayName: "Managed User",
    active: true,
    globalRoles: [],
    provisioningStatus: "PROVISIONED",
    invitedAt: null,
    lastAuth0SyncAt: new Date("2026-04-12T12:00:00.000Z"),
    lastAuth0SyncError: null,
    memberships: [
      {
        id: "membership-1",
        tenantId: "tenant-1",
        auth0OrgId: "org_123",
        role: "TENANT_ADMIN",
        permissions: ["memberships:read", "memberships:write"],
        active: true,
        tenant: {
          slug: "acme",
          name: "Acme"
        }
      }
    ],
    ...overrides
  };
}

describe("UserAdminService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-1",
      slug: "acme",
      name: "Acme"
    });
    mocks.tenantAuthConnectionFindFirst.mockResolvedValue({
      tenantId: "tenant-1",
      auth0OrganizationId: "org_123"
    });
    mocks.userFindUnique.mockResolvedValue(buildUser());
    mocks.userFindMany.mockResolvedValue([buildUser()]);
    mocks.userUpsert.mockResolvedValue({
      id: "user-1",
      auth0UserId: "auth0|user-1",
      email: "managed@example.com",
      displayName: "Managed User",
      active: true
    });
    mocks.userUpdate.mockResolvedValue(buildUser());
    mocks.membershipUpsert.mockResolvedValue({
      id: "membership-1",
      tenantId: "tenant-1",
      userId: "user-1",
      active: true
    });
    mocks.membershipFindUnique.mockResolvedValue({
      id: "membership-1",
      tenantId: "tenant-1",
      userId: "user-1",
      role: "TENANT_ADMIN",
      active: true,
      tenant: {
        id: "tenant-1",
        slug: "acme",
        name: "Acme"
      },
      user: {
        id: "user-1",
        auth0UserId: "auth0|user-1"
      }
    });
  });

  it("allows superadmin to create an Auth0-backed user with an initial membership", async () => {
    const auth0 = {
      findUserByEmail: vi.fn(async () => null),
      createUser: vi.fn(async () => ({
        user_id: "auth0|user-1",
        email: "managed@example.com",
        name: "Managed User"
      })),
      addOrganizationMember: vi.fn(async () => undefined),
      createInvitation: vi.fn(async () => "https://example.us.auth0.com/invite")
    };
    const service = new UserAdminService(auth0 as never);

    const result = await service.createUser(
      {
        userId: "auth0|daniel",
        email: "daniel@example.com",
        displayName: "Daniel",
        sessionId: "session-1",
        auth0OrganizationId: "org_123",
        tenantId: "tenant-1",
        tenantSlug: "acme",
        tenantName: "Acme",
        globalRoles: ["superadmin"],
        tenantRole: "tenant_admin",
        roles: ["superadmin", "tenant_admin"],
        permissions: ["memberships:write"],
        memberships: [],
        authTime: 1,
        amr: ["pwd", "mfa"],
        mfaFreshUntil: 1000
      },
      {
        email: "managed@example.com",
        displayName: "Managed User",
        initialMembership: {
          tenantId: "tenant-1",
          tenantRole: "tenant_admin",
          permissionOverrides: ["memberships:write"]
        }
      }
    );

    expect(auth0.createUser).toHaveBeenCalled();
    expect(auth0.addOrganizationMember).toHaveBeenCalledWith("org_123", "auth0|user-1");
    expect(result.sync.inviteUrl).toBe("https://example.us.auth0.com/invite");
  });

  it("prevents tenant admins from assigning global roles", async () => {
    const service = new UserAdminService({} as never);

    await expect(
      service.createUser(
        {
          userId: "auth0|tenant-admin",
          email: "admin@example.com",
          displayName: "Tenant Admin",
          sessionId: "session-1",
          auth0OrganizationId: "org_123",
          tenantId: "tenant-1",
          tenantSlug: "acme",
          tenantName: "Acme",
          globalRoles: [],
          tenantRole: "tenant_admin",
          roles: ["tenant_admin"],
          permissions: ["memberships:write"],
          memberships: [],
          authTime: 1,
          amr: ["pwd", "mfa"],
          mfaFreshUntil: 1000
        },
        {
          email: "managed@example.com",
          globalRoles: ["internal_operator"],
          initialMembership: {
            tenantRole: "tenant_operator"
          }
        }
      )
    ).rejects.toThrow("Only superadmins can assign global roles");
  });

  it("deactivates the user locally and syncs blocked state to Auth0", async () => {
    const auth0 = {
      updateUser: vi.fn(async () => ({
        user_id: "auth0|user-1"
      }))
    };
    const service = new UserAdminService(auth0 as never);
    mocks.userUpdate.mockResolvedValueOnce(buildUser({ active: false }));

    const result = await service.deactivateUser(
      {
        userId: "auth0|daniel",
        email: "daniel@example.com",
        displayName: "Daniel",
        sessionId: "session-1",
        auth0OrganizationId: "org_123",
        tenantId: "tenant-1",
        tenantSlug: "acme",
        tenantName: "Acme",
        globalRoles: ["superadmin"],
        tenantRole: "tenant_admin",
        roles: ["superadmin", "tenant_admin"],
        permissions: ["memberships:write"],
        memberships: [],
        authTime: 1,
        amr: ["pwd", "mfa"],
        mfaFreshUntil: 1000
      },
      "user-1"
    );

    expect(mocks.operatorSessionUpdateMany).toHaveBeenCalled();
    expect(auth0.updateUser).toHaveBeenCalledWith("auth0|user-1", expect.objectContaining({ blocked: true }));
    expect(result.sync.status).toBe("ok");
  });
});
