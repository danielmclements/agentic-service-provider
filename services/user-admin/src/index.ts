import { Prisma, TenantRole as PrismaTenantRole } from "@prisma/client";
import { AuditLogService } from "@asp/audit-log";
import { env, prisma } from "@asp/config";
import {
  AuthenticatedSession,
  GLOBAL_ROLES,
  GlobalRole,
  OPERATOR_PERMISSIONS,
  OperatorPermission,
  resolveOperatorPermissions,
  TENANT_ROLES,
  TenantRole,
  UserProvisioningStatus as UserProvisioningStatusValue
} from "@asp/types";

type Auth0UserProfile = {
  user_id: string;
  email?: string;
  name?: string;
  blocked?: boolean;
  email_verified?: boolean;
};

type AdminMembershipView = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  auth0OrgId: string;
  tenantRole: TenantRole;
  permissionOverrides: OperatorPermission[];
  effectivePermissions: OperatorPermission[];
  active: boolean;
};

export type AdminUserView = {
  id: string;
  auth0UserId: string;
  email?: string;
  displayName?: string;
  active: boolean;
  globalRoles: GlobalRole[];
  provisioningStatus: UserProvisioningStatusValue;
  invitedAt?: string;
  lastAuth0SyncAt?: string;
  lastAuth0SyncError?: string;
  memberships: AdminMembershipView[];
};

type AdminSyncResult = {
  status: "ok" | "partial";
  error?: string;
  inviteUrl?: string;
};

export type AdminMutationResult = {
  user: AdminUserView;
  sync: AdminSyncResult;
};

type CreateUserInput = {
  auth0UserId?: string;
  email: string;
  displayName?: string;
  globalRoles?: GlobalRole[];
  initialMembership?: {
    tenantId?: string;
    tenantRole: TenantRole;
    permissionOverrides?: OperatorPermission[];
    active?: boolean;
  };
};

type UpdateUserInput = {
  email?: string;
  displayName?: string;
  active?: boolean;
  globalRoles?: GlobalRole[];
};

type CreateMembershipInput = {
  tenantId: string;
  tenantRole: TenantRole;
  permissionOverrides?: OperatorPermission[];
  active?: boolean;
};

type UpdateMembershipInput = {
  tenantRole?: TenantRole;
  permissionOverrides?: OperatorPermission[];
  active?: boolean;
};

const PRISMA_TENANT_ROLE_BY_APP_ROLE: Record<TenantRole, PrismaTenantRole> = {
  tenant_admin: PrismaTenantRole.TENANT_ADMIN,
  tenant_operator: PrismaTenantRole.TENANT_OPERATOR,
  tenant_end_user: PrismaTenantRole.TENANT_END_USER
};

const PRISMA_USER_PROVISIONING_STATUS = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PROVISIONED: "PROVISIONED",
  INVITED: "INVITED",
  ERROR: "ERROR"
} as const;

type PrismaUserProvisioningStatus =
  (typeof PRISMA_USER_PROVISIONING_STATUS)[keyof typeof PRISMA_USER_PROVISIONING_STATUS];

type AdminUserRecord = Prisma.UserGetPayload<{
  include: {
    memberships: {
      include: {
        tenant: true;
      };
      orderBy: {
        createdAt: "asc";
      };
    };
  };
}>;

function coerceGlobalRoles(input: unknown): GlobalRole[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((role): role is GlobalRole => typeof role === "string" && (GLOBAL_ROLES as readonly string[]).includes(role));
}

function coercePermissionOverrides(input: unknown): OperatorPermission[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter(
    (permission): permission is OperatorPermission =>
      typeof permission === "string" && (OPERATOR_PERMISSIONS as readonly string[]).includes(permission)
  );
}

function assertTenantRole(role: string): TenantRole {
  if (!(TENANT_ROLES as readonly string[]).includes(role)) {
    throw new Error("Tenant role is invalid");
  }

  return role as TenantRole;
}

function toPrismaTenantRole(role: TenantRole): PrismaTenantRole {
  return PRISMA_TENANT_ROLE_BY_APP_ROLE[role];
}

function toProvisioningStatusValue(status: string): UserProvisioningStatusValue {
  return status.toLowerCase() as UserProvisioningStatusValue;
}

function managementAudience() {
  return env.AUTH0_MANAGEMENT_AUDIENCE ?? `https://${env.AUTH0_DOMAIN}/api/v2/`;
}

export class Auth0ManagementClient {
  private cachedToken?: { value: string; expiresAt: number };

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async getAccessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.value;
    }

    if (!env.AUTH0_MANAGEMENT_CLIENT_ID || !env.AUTH0_MANAGEMENT_CLIENT_SECRET) {
      throw new Error("Auth0 Management API credentials are not configured");
    }

    const response = await this.fetchImpl(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env.AUTH0_MANAGEMENT_CLIENT_ID,
        client_secret: env.AUTH0_MANAGEMENT_CLIENT_SECRET,
        audience: managementAudience()
      })
    });

    const payload = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || `Auth0 Management token request failed with status ${response.status}`);
    }

    this.cachedToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 300) * 1000
    };

    return payload.access_token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(`https://${env.AUTH0_DOMAIN}/api/v2${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    if (!response.ok) {
      const message = typeof payload?.message === "string" ? payload.message : `Auth0 request failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload as T;
  }

  async getUserById(auth0UserId: string) {
    return this.request<Auth0UserProfile>(`/users/${encodeURIComponent(auth0UserId)}`);
  }

  async findUserByEmail(email: string) {
    const users = await this.request<Auth0UserProfile[]>(`/users-by-email?email=${encodeURIComponent(email)}`);
    return users[0] ?? null;
  }

  async createUser(input: { email: string; displayName?: string; connectionName: string }) {
    return this.request<Auth0UserProfile>("/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: input.email,
        name: input.displayName ?? input.email,
        connection: input.connectionName,
        email_verified: false
      })
    });
  }

  async updateUser(auth0UserId: string, input: { email?: string; displayName?: string; blocked?: boolean }) {
    return this.request<Auth0UserProfile>(`/users/${encodeURIComponent(auth0UserId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(input.email ? { email: input.email } : {}),
        ...(input.displayName ? { name: input.displayName } : {}),
        ...(typeof input.blocked === "boolean" ? { blocked: input.blocked } : {})
      })
    });
  }

  async addOrganizationMember(organizationId: string, auth0UserId: string) {
    await this.request(`/organizations/${encodeURIComponent(organizationId)}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        members: [auth0UserId]
      })
    });
  }

  async removeOrganizationMember(organizationId: string, auth0UserId: string) {
    await this.request(`/organizations/${encodeURIComponent(organizationId)}/members`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        members: [auth0UserId]
      })
    });
  }

  async createInvitation(auth0UserId: string) {
    const payload = await this.request<{ ticket?: string }>("/tickets/password-change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_id: auth0UserId,
        client_id: env.AUTH0_CLIENT_ID,
        result_url: env.AUTH0_LOGOUT_URL,
        ttl_sec: 60 * 60 * 24 * 7
      })
    });

    if (!payload.ticket) {
      throw new Error("Auth0 did not return an invitation URL");
    }

    return payload.ticket;
  }
}

function normalizeMembership(membership: {
  id: string;
  tenantId: string;
  auth0OrgId: string;
  role: string;
  permissions: unknown;
  active: boolean;
  tenant: { slug: string; name: string };
}) {
  const tenantRole = assertTenantRole(membership.role.toLowerCase());
  const permissionOverrides = coercePermissionOverrides(membership.permissions);

  return {
    id: membership.id,
    tenantId: membership.tenantId,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    auth0OrgId: membership.auth0OrgId,
    tenantRole,
    permissionOverrides,
    effectivePermissions: resolveOperatorPermissions({
      tenantRole,
      permissionOverrides
    }),
    active: membership.active
  } satisfies AdminMembershipView;
}

function normalizeUser(user: AdminUserRecord) {
  return {
    id: user.id,
    auth0UserId: user.auth0UserId,
    email: user.email ?? undefined,
    displayName: user.displayName ?? undefined,
    active: user.active,
    globalRoles: coerceGlobalRoles(user.globalRoles),
    provisioningStatus: toProvisioningStatusValue(user.provisioningStatus),
    invitedAt: user.invitedAt?.toISOString(),
    lastAuth0SyncAt: user.lastAuth0SyncAt?.toISOString(),
    lastAuth0SyncError: user.lastAuth0SyncError ?? undefined,
    memberships: user.memberships.map(normalizeMembership)
  } satisfies AdminUserView;
}

function canManageTenant(session: AuthenticatedSession, tenantId: string) {
  if (session.globalRoles.includes("superadmin")) {
    return true;
  }

  return session.tenantId === tenantId && session.permissions.includes("memberships:write");
}

function canViewTenant(session: AuthenticatedSession, tenantId: string) {
  if (session.globalRoles.includes("superadmin")) {
    return true;
  }

  return session.tenantId === tenantId && (session.permissions.includes("memberships:read") || session.permissions.includes("memberships:write"));
}

function ensureGlobalRoleAssignmentAllowed(session: AuthenticatedSession, globalRoles: GlobalRole[] | undefined) {
  if (!globalRoles?.length) {
    return;
  }

  if (!session.globalRoles.includes("superadmin")) {
    throw new Error("Only superadmins can assign global roles");
  }
}

function ensureTenantScopedAdmin(session: AuthenticatedSession, tenantId: string) {
  if (!canManageTenant(session, tenantId)) {
    throw new Error("This session cannot manage users for the requested tenant");
  }
}

export class UserAdminService {
  constructor(
    private readonly auth0 = new Auth0ManagementClient(),
    private readonly auditLogService = new AuditLogService()
  ) {}

  private async loadUserById(userId: string): Promise<AdminUserRecord> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            tenant: true
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  private async assertCanAccessUser(session: AuthenticatedSession, userId: string, mode: "read" | "write") {
    const user = await this.loadUserById(userId);

    if (session.globalRoles.includes("superadmin")) {
      return user;
    }

    const visibleMembership = user.memberships.find((membership) =>
      mode === "write" ? canManageTenant(session, membership.tenantId) : canViewTenant(session, membership.tenantId)
    );

    if (!visibleMembership) {
      throw new Error(`This session cannot ${mode === "write" ? "manage" : "view"} the requested user`);
    }

    return user;
  }

  private async resolveTargetTenant(tenantIdOrSlug: string) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ id: tenantIdOrSlug }, { slug: tenantIdOrSlug }]
      }
    });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    return tenant;
  }

  private async resolveAuthConnection(tenantId: string) {
    const authConnection = await prisma.tenantAuthConnection.findFirst({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    });

    if (!authConnection) {
      throw new Error("Tenant is missing an Auth0 organization mapping");
    }

    return authConnection;
  }

  private async writeSyncState(
    userId: string,
    input: { status: PrismaUserProvisioningStatus; error?: string | null; invited?: boolean }
  ): Promise<AdminUserRecord> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        provisioningStatus: input.status,
        lastAuth0SyncAt: new Date(),
        lastAuth0SyncError: input.error ?? null,
        invitedAt: input.invited ? new Date() : undefined
      },
      include: {
        memberships: {
          include: {
            tenant: true
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });
  }

  private async syncAuth0User(user: { id: string; auth0UserId: string; email: string | null; displayName: string | null; active: boolean }) {
    try {
      await this.auth0.updateUser(user.auth0UserId, {
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        blocked: !user.active
      });

      return {
        user: await this.writeSyncState(user.id, {
          status: PRISMA_USER_PROVISIONING_STATUS.PROVISIONED,
          error: null
        }),
        sync: { status: "ok" } satisfies AdminSyncResult
      };
    } catch (error) {
      return {
        user: await this.writeSyncState(user.id, {
          status: PRISMA_USER_PROVISIONING_STATUS.ERROR,
          error: error instanceof Error ? error.message : "Auth0 sync failed"
        }),
        sync: {
          status: "partial",
          error: error instanceof Error ? error.message : "Auth0 sync failed"
        } satisfies AdminSyncResult
      };
    }
  }

  private async inviteUserInternal(user: { id: string; auth0UserId: string }) {
    try {
      const inviteUrl = await this.auth0.createInvitation(user.auth0UserId);
      const updatedUser = await this.writeSyncState(user.id, {
          status: PRISMA_USER_PROVISIONING_STATUS.INVITED,
        error: null,
        invited: true
      });

      return {
        user: updatedUser,
        sync: { status: "ok", inviteUrl } satisfies AdminSyncResult
      };
    } catch (error) {
      return {
        user: await this.writeSyncState(user.id, {
          status: PRISMA_USER_PROVISIONING_STATUS.ERROR,
          error: error instanceof Error ? error.message : "Auth0 invitation failed"
        }),
        sync: {
          status: "partial",
          error: error instanceof Error ? error.message : "Auth0 invitation failed"
        } satisfies AdminSyncResult
      };
    }
  }

  private async logAdminEvent(input: {
    session: AuthenticatedSession;
    tenantId: string;
    eventType: string;
    targetUserId: string;
    payload: Record<string, unknown>;
  }) {
    await this.auditLogService.log({
      tenantId: input.tenantId,
      eventType: input.eventType,
      actor: "operator",
      actorSubject: input.session.userId,
      actorOrgId: input.session.auth0OrganizationId,
      actorSessionId: input.session.sessionId,
      actorDisplayName: input.session.displayName,
      payload: {
        targetUserId: input.targetUserId,
        ...input.payload
      }
    });
  }

  async listUsers(session: AuthenticatedSession, filters?: { tenantId?: string }) {
    const tenantId = filters?.tenantId;
    if (tenantId) {
      const tenant = await this.resolveTargetTenant(tenantId);
      if (!canViewTenant(session, tenant.id)) {
        throw new Error("This session cannot view users for the requested tenant");
      }
    } else if (!session.globalRoles.includes("superadmin") && !session.permissions.includes("memberships:read") && !session.permissions.includes("memberships:write")) {
      throw new Error("This session cannot view users");
    }

    const users = await prisma.user.findMany({
      where: tenantId
        ? {
            memberships: {
              some: {
                tenant: {
                  OR: [{ id: tenantId }, { slug: tenantId }]
                }
              }
            }
          }
        : session.globalRoles.includes("superadmin")
          ? undefined
          : {
              memberships: {
                some: {
                  tenantId: session.tenantId
                }
              }
            },
      include: {
        memberships: {
          include: {
            tenant: true
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }]
    });

    return users.map(normalizeUser);
  }

  async getUser(session: AuthenticatedSession, userId: string) {
    const user = await this.assertCanAccessUser(session, userId, "read");
    return normalizeUser(user);
  }

  async createUser(session: AuthenticatedSession, input: CreateUserInput): Promise<AdminMutationResult> {
    ensureGlobalRoleAssignmentAllowed(session, input.globalRoles);

    const initialMembershipTenant = input.initialMembership?.tenantId;
    const targetTenant = initialMembershipTenant
      ? await this.resolveTargetTenant(initialMembershipTenant)
      : input.initialMembership
        ? await this.resolveTargetTenant(session.tenantId)
        : null;

    if (!targetTenant && !session.globalRoles.includes("superadmin")) {
      throw new Error("Non-superadmin sessions must create users inside their active tenant");
    }

    if (targetTenant) {
      ensureTenantScopedAdmin(session, targetTenant.id);
    }

    let auth0User: Auth0UserProfile | null = null;
    let createdAuth0User = false;

    if (input.auth0UserId) {
      auth0User = await this.auth0.getUserById(input.auth0UserId);
    } else {
      auth0User = await this.auth0.findUserByEmail(input.email);
      if (!auth0User) {
        const connectionName = env.AUTH0_PROVISIONING_CONNECTION;
        if (!connectionName) {
          throw new Error("AUTH0_PROVISIONING_CONNECTION is required to create new Auth0 users");
        }

        auth0User = await this.auth0.createUser({
          email: input.email,
          displayName: input.displayName,
          connectionName
        });
        createdAuth0User = true;
      }
    }

    if (!auth0User?.user_id) {
      throw new Error("Auth0 user could not be resolved");
    }

    const authConnection = targetTenant ? await this.resolveAuthConnection(targetTenant.id) : null;

    const persistedUser = await prisma.user.upsert({
      where: { auth0UserId: auth0User.user_id },
      update: {
        email: input.email,
        displayName: input.displayName ?? auth0User.name ?? undefined,
        globalRoles: input.globalRoles ?? undefined,
        active: true
      },
      create: {
        auth0UserId: auth0User.user_id,
        email: input.email,
        displayName: input.displayName ?? auth0User.name ?? null,
        globalRoles: input.globalRoles ?? [],
        active: true,
        provisioningStatus: PRISMA_USER_PROVISIONING_STATUS.PROVISIONED,
        lastAuth0SyncAt: new Date()
      }
    });

    if (targetTenant && input.initialMembership) {
      await prisma.tenantMembership.upsert({
        where: {
          tenantId_userId: {
            tenantId: targetTenant.id,
            userId: persistedUser.id
          }
        },
        update: {
          auth0OrgId: authConnection!.auth0OrganizationId,
          email: input.email,
          displayName: input.displayName ?? auth0User.name ?? undefined,
          role: toPrismaTenantRole(input.initialMembership.tenantRole),
          permissions: input.initialMembership.permissionOverrides ?? [],
          active: input.initialMembership.active ?? true
        },
        create: {
          tenantId: targetTenant.id,
          userId: persistedUser.id,
          auth0OrgId: authConnection!.auth0OrganizationId,
          email: input.email,
          displayName: input.displayName ?? auth0User.name ?? null,
          role: toPrismaTenantRole(input.initialMembership.tenantRole),
          permissions: input.initialMembership.permissionOverrides ?? [],
          active: input.initialMembership.active ?? true
        }
      });

      await this.auth0.addOrganizationMember(authConnection!.auth0OrganizationId, auth0User.user_id);
    }

    const invited = await this.inviteUserInternal({
      id: persistedUser.id,
      auth0UserId: persistedUser.auth0UserId
    });

    const normalized = normalizeUser(invited.user);
    await this.logAdminEvent({
      session,
      tenantId: targetTenant?.id ?? session.tenantId,
      eventType: "ADMIN_USER_CREATED",
      targetUserId: normalized.auth0UserId,
      payload: {
        createdAuth0User,
        globalRoles: normalized.globalRoles,
        tenantId: targetTenant?.id ?? null,
        sync: invited.sync
      }
    });

    return {
      user: normalized,
      sync: invited.sync
    };
  }

  async updateUser(session: AuthenticatedSession, userId: string, input: UpdateUserInput): Promise<AdminMutationResult> {
    ensureGlobalRoleAssignmentAllowed(session, input.globalRoles);
    const existingUser = await this.assertCanAccessUser(session, userId, "write");

    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        email: input.email,
        displayName: input.displayName,
        active: input.active,
        globalRoles: input.globalRoles
      },
      include: {
        memberships: {
          include: {
            tenant: true
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (input.active === false) {
      await prisma.tenantMembership.updateMany({
        where: { userId: updatedUser.id },
        data: { active: false }
      });
      await prisma.operatorSession.updateMany({
        where: { userId: updatedUser.id },
        data: { revokedAt: new Date() }
      });
    }

    const synced = await this.syncAuth0User(updatedUser);
    const normalized = normalizeUser(synced.user);

    await this.logAdminEvent({
      session,
      tenantId: normalized.memberships[0]?.tenantId ?? session.tenantId,
      eventType: "ADMIN_USER_UPDATED",
      targetUserId: normalized.auth0UserId,
      payload: {
        updates: input,
        sync: synced.sync
      }
    });

    return {
      user: normalized,
      sync: synced.sync
    };
  }

  async deactivateUser(session: AuthenticatedSession, userId: string) {
    return this.updateUser(session, userId, { active: false });
  }

  async inviteUser(session: AuthenticatedSession, userId: string): Promise<AdminMutationResult> {
    const existingUser = await this.assertCanAccessUser(session, userId, "write");
    const invited = await this.inviteUserInternal({
      id: existingUser.id,
      auth0UserId: existingUser.auth0UserId
    });
    const normalized = normalizeUser(invited.user);

    await this.logAdminEvent({
      session,
      tenantId: normalized.memberships[0]?.tenantId ?? session.tenantId,
      eventType: "ADMIN_USER_INVITED",
      targetUserId: normalized.auth0UserId,
      payload: {
        sync: invited.sync
      }
    });

    return {
      user: normalized,
      sync: invited.sync
    };
  }

  async listMemberships(session: AuthenticatedSession, userId: string) {
    const user = await this.assertCanAccessUser(session, userId, "read");
    return normalizeUser(user).memberships.filter((membership) => canViewTenant(session, membership.tenantId));
  }

  async addMembership(session: AuthenticatedSession, userId: string, input: CreateMembershipInput): Promise<AdminMutationResult> {
    const user = await this.loadUserById(userId);
    const tenant = await this.resolveTargetTenant(input.tenantId);
    ensureTenantScopedAdmin(session, tenant.id);
    const authConnection = await this.resolveAuthConnection(tenant.id);

    const membership = await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id
        }
      },
      update: {
        auth0OrgId: authConnection.auth0OrganizationId,
        role: toPrismaTenantRole(input.tenantRole),
        permissions: input.permissionOverrides ?? [],
        active: input.active ?? true,
        email: user.email,
        displayName: user.displayName
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        auth0OrgId: authConnection.auth0OrganizationId,
        email: user.email,
        displayName: user.displayName,
        role: toPrismaTenantRole(input.tenantRole),
        permissions: input.permissionOverrides ?? [],
        active: input.active ?? true
      }
    });

    let sync: AdminSyncResult = { status: "ok" };
    try {
      if (membership.active) {
        await this.auth0.addOrganizationMember(authConnection.auth0OrganizationId, user.auth0UserId);
        await this.writeSyncState(user.id, {
          status: PRISMA_USER_PROVISIONING_STATUS.PROVISIONED,
          error: null
        });
      }
    } catch (error) {
      sync = {
        status: "partial",
        error: error instanceof Error ? error.message : "Auth0 organization sync failed"
      };
      await this.writeSyncState(user.id, {
        status: PRISMA_USER_PROVISIONING_STATUS.ERROR,
        error: sync.error
      });
    }

    const refreshed = await this.loadUserById(user.id);
    const normalized = normalizeUser(refreshed);

    await this.logAdminEvent({
      session,
      tenantId: tenant.id,
      eventType: "ADMIN_MEMBERSHIP_CREATED",
      targetUserId: normalized.auth0UserId,
      payload: {
        membershipId: membership.id,
        tenantRole: input.tenantRole,
        sync
      }
    });

    return {
      user: normalized,
      sync
    };
  }

  async updateMembership(session: AuthenticatedSession, membershipId: string, input: UpdateMembershipInput): Promise<AdminMutationResult> {
    const existingMembership = await prisma.tenantMembership.findUnique({
      where: { id: membershipId },
      include: {
        tenant: true,
        user: true
      }
    });

    if (!existingMembership) {
      throw new Error("Membership not found");
    }

    ensureTenantScopedAdmin(session, existingMembership.tenantId);
    const authConnection = await this.resolveAuthConnection(existingMembership.tenantId);

    const updatedMembership = await prisma.tenantMembership.update({
      where: { id: membershipId },
      data: {
        role: input.tenantRole ? toPrismaTenantRole(input.tenantRole) : undefined,
        permissions: input.permissionOverrides ?? undefined,
        active: input.active
      }
    });

    let sync: AdminSyncResult = { status: "ok" };
    try {
      if (typeof input.active === "boolean") {
        if (input.active) {
          await this.auth0.addOrganizationMember(authConnection.auth0OrganizationId, existingMembership.user.auth0UserId);
        } else {
          await this.auth0.removeOrganizationMember(authConnection.auth0OrganizationId, existingMembership.user.auth0UserId);
          await prisma.operatorSession.updateMany({
            where: {
              userId: existingMembership.userId,
              tenantId: existingMembership.tenantId
            },
            data: { revokedAt: new Date() }
          });
        }
      }

      await this.writeSyncState(existingMembership.userId, {
        status: PRISMA_USER_PROVISIONING_STATUS.PROVISIONED,
        error: null
      });
    } catch (error) {
      sync = {
        status: "partial",
        error: error instanceof Error ? error.message : "Auth0 organization sync failed"
      };
      await this.writeSyncState(existingMembership.userId, {
        status: PRISMA_USER_PROVISIONING_STATUS.ERROR,
        error: sync.error
      });
    }

    const refreshed = await this.loadUserById(existingMembership.userId);
    const normalized = normalizeUser(refreshed);

    await this.logAdminEvent({
      session,
      tenantId: existingMembership.tenantId,
      eventType: "ADMIN_MEMBERSHIP_UPDATED",
      targetUserId: normalized.auth0UserId,
      payload: {
        membershipId: updatedMembership.id,
        updates: input,
        sync
      }
    });

    return {
      user: normalized,
      sync
    };
  }
}
