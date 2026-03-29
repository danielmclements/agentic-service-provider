import { condition, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import { WorkflowTicketPayload } from "@asp/types";
import type * as activities from "./activities";

const { triageAndEvaluatePolicy, markExecutionRun, createApproval, executeAction, rejectAction, blockAction } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute"
});

const approvalDecisionSignal = defineSignal<[{
  approved: boolean;
  reviewerIdentity: string;
  comment?: string;
}]>("approvalDecisionSignal");

export async function helpdeskTicketWorkflow(input: WorkflowTicketPayload) {
  let approvalDecision: { approved: boolean; reviewerIdentity: string; comment?: string } | null = null;

  setHandler(approvalDecisionSignal, (decision) => {
    approvalDecision = decision;
  });

  await markExecutionRun(input.ticketId, "RUNNING", "TRIAGE");
  const triageOutcome = await triageAndEvaluatePolicy(input.ticketId, input.tenantId);

  if (triageOutcome.decision === "BLOCK") {
    await blockAction(input.ticketId, input.tenantId, triageOutcome.actionRequestId);
    await markExecutionRun(input.ticketId, "FAILED", "BLOCKED", "Action blocked by policy engine");
    return { status: "BLOCKED" };
  }

  if (triageOutcome.decision === "REQUIRES_APPROVAL") {
    await createApproval(input.ticketId, triageOutcome.actionRequestId);
    await markExecutionRun(input.ticketId, "WAITING_APPROVAL", "WAITING_APPROVAL");
    await condition(() => approvalDecision !== null);
    const decision = approvalDecision!;

    if (!decision.approved) {
      await rejectAction(input.ticketId, input.tenantId, triageOutcome.actionRequestId, decision.reviewerIdentity, decision.comment);
      await markExecutionRun(input.ticketId, "FAILED", "REJECTED", decision.comment);
      return { status: "REJECTED" };
    }
  }

  await markExecutionRun(input.ticketId, "RUNNING", "EXECUTION");
  const result = await executeAction(input.ticketId, input.tenantId, triageOutcome.actionRequestId);
  await markExecutionRun(input.ticketId, "COMPLETED", "DONE");

  return {
    status: "RESOLVED",
    result
  };
}
