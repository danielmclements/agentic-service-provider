import { prisma } from "@asp/config";
import { TenantContext } from "@asp/types";

export class TenantContextService {
  async getTenantContext(tenantId: string): Promise<TenantContext> {
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ id: tenantId }, { slug: tenantId }]
      },
      include: { policy: true }
    });

    if (!tenant || !tenant.policy) {
      throw new Error(`Tenant context not found for tenant ${tenantId}`);
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      allowedActions: tenant.policy.allowedActions as TenantContext["allowedActions"],
      approvalRules: tenant.policy.approvalRules as TenantContext["approvalRules"],
      identityProvider: tenant.identityProvider,
      verification: (tenant.policy.verificationSettings as TenantContext["verification"] | null) ?? {
        requiredActions: ["RESET_PASSWORD", "ADD_TO_GROUP"],
        primaryMethod: "PUSH",
        allowSmsFallback: false,
        requireManualReviewOnMissingFactor: true,
        challengeTtlMinutes: 10
      },
      model: tenant.policy.modelSettings as TenantContext["model"]
    };
  }
}
