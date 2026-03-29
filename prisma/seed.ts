import { prisma } from "@asp/config";
import { ActionType, PolicyDecision } from "@prisma/client";

async function seed() {
  await prisma.tenant.upsert({
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
          modelSettings: {
            provider: "heuristic",
            modelName: "local-heuristic"
          }
        }
      }
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
