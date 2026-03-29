import { ExecutionCommand } from "@asp/types";

export interface IdentityProvider {
  resetPassword(command: ExecutionCommand): Promise<Record<string, unknown>>;
  unlockAccount(command: ExecutionCommand): Promise<Record<string, unknown>>;
  addToGroup(command: ExecutionCommand): Promise<Record<string, unknown>>;
}

export class MockIdentityProvider implements IdentityProvider {
  async resetPassword(command: ExecutionCommand) {
    return {
      status: "ok",
      operation: "reset_password",
      userEmail: command.userEmail,
      temporaryPasswordIssued: true
    };
  }

  async unlockAccount(command: ExecutionCommand) {
    return {
      status: "ok",
      operation: "unlock_account",
      userEmail: command.userEmail
    };
  }

  async addToGroup(command: ExecutionCommand) {
    return {
      status: "ok",
      operation: "add_to_group",
      userEmail: command.userEmail,
      groupId: command.groupId ?? "general-access"
    };
  }
}
