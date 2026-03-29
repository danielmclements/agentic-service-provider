import { ExecutionCommand } from "@asp/types";
import { IdentityProvider, MockIdentityProvider } from "@asp/mock-identity";
import { M365IdentityProvider } from "@asp/m365";

export class IdentityOpsAgent {
  private readonly providers: Record<string, IdentityProvider> = {
    MOCK: new MockIdentityProvider(),
    M365: new M365IdentityProvider()
  };

  async execute(identityProvider: string, command: ExecutionCommand) {
    const provider = this.providers[identityProvider];

    if (!provider) {
      throw new Error(`Unsupported identity provider ${identityProvider}`);
    }

    switch (command.actionType) {
      case "RESET_PASSWORD":
        return provider.resetPassword(command);
      case "UNLOCK_ACCOUNT":
        return provider.unlockAccount(command);
      case "ADD_TO_GROUP":
        return provider.addToGroup(command);
      case "DISABLE_MFA":
        throw new Error("DISABLE_MFA is blocked in MVP");
      default:
        throw new Error(`Unhandled action ${command.actionType}`);
    }
  }
}
