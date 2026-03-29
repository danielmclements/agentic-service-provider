import { Client, Connection, WorkflowHandle } from "@temporalio/client";
import { env } from "@asp/config";
import { WorkflowTicketPayload } from "@asp/types";

export async function createTemporalClient() {
  const connection = await Connection.connect({
    address: env.TEMPORAL_ADDRESS
  });

  return new Client({
    connection,
    namespace: env.TEMPORAL_NAMESPACE
  });
}

export async function startTicketWorkflow(payload: WorkflowTicketPayload): Promise<WorkflowHandle> {
  const client = await createTemporalClient();
  return client.workflow.start("helpdeskTicketWorkflow", {
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    args: [payload],
    workflowId: `ticket-${payload.ticketId}`
  });
}

export async function signalApprovalDecision(workflowId: string, input: { approved: boolean; reviewerIdentity: string; comment?: string }) {
  const client = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal("approvalDecisionSignal", input);
}
