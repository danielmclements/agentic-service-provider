import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionRequestFindUniqueOrThrow: vi.fn(),
  verificationChallengeFindUnique: vi.fn(),
  verificationChallengeCreate: vi.fn(),
  verificationChallengeUpdate: vi.fn(),
  actionRequestUpdate: vi.fn()
}));

vi.mock("@asp/config", () => ({
  prisma: {
    actionRequest: {
      findUniqueOrThrow: mocks.actionRequestFindUniqueOrThrow,
      update: mocks.actionRequestUpdate
    },
    verificationChallenge: {
      findUnique: mocks.verificationChallengeFindUnique,
      create: mocks.verificationChallengeCreate,
      update: mocks.verificationChallengeUpdate
    }
  }
}));

import { UserVerificationService } from "./index";

describe("UserVerificationService", () => {
  const service = new UserVerificationService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending push challenge for actions that require verification", async () => {
    mocks.actionRequestFindUniqueOrThrow.mockResolvedValue({
      id: "action-1",
      actionType: "RESET_PASSWORD"
    });
    mocks.verificationChallengeFindUnique.mockResolvedValue(null);
    mocks.verificationChallengeCreate.mockResolvedValue({
      id: "verification-1",
      method: "PUSH",
      status: "PENDING",
      targetReference: "user@example.com",
      expiresAt: new Date("2026-01-01T00:10:00Z")
    });

    const result = await service.ensureChallenge("action-1", "user@example.com", {
      tenantId: "tenant-1",
      tenantName: "Acme",
      allowedActions: ["RESET_PASSWORD"],
      approvalRules: {},
      identityProvider: "MOCK",
      verification: {
        requiredActions: ["RESET_PASSWORD"],
        primaryMethod: "PUSH",
        allowSmsFallback: true,
        requireManualReviewOnMissingFactor: true,
        challengeTtlMinutes: 10
      },
      model: {
        provider: "heuristic",
        modelName: "local"
      }
    });

    expect(result.required).toBe(true);
    expect(mocks.verificationChallengeCreate).toHaveBeenCalled();
    expect(mocks.actionRequestUpdate).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: { status: "WAITING_VERIFICATION" }
    });
  });

  it("rejects replay attempts for closed verification challenges", async () => {
    mocks.verificationChallengeFindUnique.mockResolvedValue({
      id: "verification-1",
      actionRequestId: "action-1",
      status: "VERIFIED",
      expiresAt: new Date("2026-01-01T00:10:00Z")
    });

    await expect(service.recordDecision("action-1", "VERIFIED", { method: "push" })).rejects.toThrow(
      "Verification challenge is already closed"
    );
    expect(mocks.verificationChallengeUpdate).not.toHaveBeenCalled();
  });
});
