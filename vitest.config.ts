import path from "node:path";
import { defineConfig } from "vitest/config";

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@asp/types": path.resolve(root, "shared/types/src"),
      "@asp/config": path.resolve(root, "shared/config/src"),
      "@asp/logger": path.resolve(root, "shared/logger/src"),
      "@asp/validation": path.resolve(root, "shared/validation/src"),
      "@asp/tenant-context": path.resolve(root, "services/tenant-context/src"),
      "@asp/policy-engine": path.resolve(root, "services/policy-engine/src"),
      "@asp/ticket-intake": path.resolve(root, "services/ticket-intake/src"),
      "@asp/approval-service": path.resolve(root, "services/approval-service/src"),
      "@asp/audit-log": path.resolve(root, "services/audit-log/src"),
      "@asp/orchestration": path.resolve(root, "services/orchestration/src"),
      "@asp/helpdesk-triage": path.resolve(root, "agents/helpdesk-triage/src"),
      "@asp/identity-ops": path.resolve(root, "agents/identity-ops/src"),
      "@asp/mock-identity": path.resolve(root, "integrations/mock-identity/src"),
      "@asp/m365": path.resolve(root, "integrations/m365/src")
    }
  },
  test: {
    environment: "node",
    passWithNoTests: true
  }
});
