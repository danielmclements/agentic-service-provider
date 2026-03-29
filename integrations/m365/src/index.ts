import { ExecutionCommand } from "@asp/types";
import { IdentityProvider } from "@asp/mock-identity";

export class M365IdentityProvider implements IdentityProvider {
  async resetPassword(command: ExecutionCommand) {
    return {
      status: "stubbed",
      provider: "m365",
      operation: "reset_password",
      userEmail: command.userEmail
    };
  }

  async unlockAccount(command: ExecutionCommand) {
    return {
      status: "stubbed",
      provider: "m365",
      operation: "unlock_account",
      userEmail: command.userEmail
    };
  }

  async addToGroup(command: ExecutionCommand) {
    return {
      status: "stubbed",
      provider: "m365",
      operation: "add_to_group",
      userEmail: command.userEmail,
      groupId: command.groupId ?? "general-access"
    };
  }
}
