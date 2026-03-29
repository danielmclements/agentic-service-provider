import { Prisma } from "@prisma/client";
import { prisma } from "@asp/config";
import { TenantContext, VerificationMethod, VerificationStatus } from "@asp/types";

function requiresVerification(actionType: string, tenantContext: TenantContext) {
  return tenantContext.verification.requiredActions.includes(actionType as TenantContext["allowedActions"][number]);
}

function pickMethod(tenantContext: TenantContext): VerificationMethod {
  return tenantContext.verification.primaryMethod;
}

export class UserVerificationService {
  async ensureChallenge(actionRequestId: string, userEmail: string, tenantContext: TenantContext) {
    const actionRequest = await prisma.actionRequest.findUniqueOrThrow({
      where: { id: actionRequestId }
    });

    if (!requiresVerification(actionRequest.actionType, tenantContext)) {
      return {
        required: false,
        challenge: null
      };
    }

    const existing = await prisma.verificationChallenge.findUnique({
      where: { actionRequestId }
    });

    if (existing) {
      return {
        required: true,
        challenge: existing
      };
    }

    const challenge = await prisma.verificationChallenge.create({
      data: {
        actionRequestId,
        method: pickMethod(tenantContext),
        status: "PENDING",
        targetReference: userEmail,
        expiresAt: new Date(Date.now() + tenantContext.verification.challengeTtlMinutes * 60 * 1000)
      }
    });

    await prisma.actionRequest.update({
      where: { id: actionRequestId },
      data: { status: "WAITING_VERIFICATION" }
    });

    return {
      required: true,
      challenge
    };
  }

  async getChallengeByActionRequest(actionRequestId: string) {
    return prisma.verificationChallenge.findUnique({
      where: { actionRequestId }
    });
  }

  async recordDecision(actionRequestId: string, status: VerificationStatus, evidencePayload?: Record<string, unknown>) {
    const challenge = await prisma.verificationChallenge.findUnique({
      where: { actionRequestId }
    });

    if (!challenge) {
      throw new Error("Verification challenge not found");
    }

    if (challenge.status === "VERIFIED" || challenge.status === "FAILED" || challenge.status === "EXPIRED") {
      throw new Error("Verification challenge is already closed");
    }

    if (challenge.expiresAt.getTime() <= Date.now() && status === "VERIFIED") {
      await prisma.verificationChallenge.update({
        where: { actionRequestId },
        data: {
          status: "EXPIRED",
          attemptCount: { increment: 1 }
        }
      });
      throw new Error("Verification challenge has expired");
    }

    const updated = await prisma.verificationChallenge.update({
      where: { actionRequestId },
      data: {
        status,
        attemptCount: { increment: 1 },
        evidencePayload: evidencePayload as Prisma.InputJsonValue | undefined,
        completedAt: status === "PENDING" ? null : new Date()
      }
    });

    await prisma.actionRequest.update({
      where: { id: actionRequestId },
      data: {
        status: status === "VERIFIED" || status === "BYPASSED" ? "PENDING" : "REJECTED",
        errorMessage: status === "FAILED" || status === "EXPIRED" ? "User verification did not complete successfully" : null
      }
    });

    return updated;
  }
}
