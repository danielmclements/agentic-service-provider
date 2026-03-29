const baseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const apiKey = process.env.API_KEY ?? "dev-api-key";
const operatorKey = process.env.OPERATOR_API_KEY ?? "dev-operator-key";
const tenantId = process.env.TENANT_ID ?? "acme";

type TicketResponse = {
  ticketId: string;
  workflowId: string;
  status: string;
};

type ApprovalListResponse = {
  approvals: Array<{
    id: string;
    status: string;
    ticket: {
      id: string;
    };
  }>;
};

type TicketDetailsResponse = {
  ticket: {
    id: string;
    status: string;
  };
};

type AuditResponse = {
  events: Array<{
    eventType: string;
  }>;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${input}`);
  }

  return (await response.json()) as T;
}

async function pollForApproval(ticketId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const data = await requestJson<ApprovalListResponse>(`${baseUrl}/api/approvals`, {
      headers: {
        "x-operator-key": operatorKey,
        "x-tenant-id": tenantId
      }
    });

    const approval = data.approvals.find((item) => item.ticket.id === ticketId && item.status === "PENDING");

    if (approval) {
      return approval;
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for approval for ticket ${ticketId}`);
}

async function pollForResolution(ticketId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const data = await requestJson<TicketDetailsResponse>(`${baseUrl}/api/tickets/${ticketId}`, {
      headers: {
        "x-api-key": apiKey,
        "x-tenant-id": tenantId
      }
    });

    if (data.ticket.status === "RESOLVED") {
      return data.ticket;
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ticket ${ticketId} to resolve`);
}

async function main() {
  const idempotencyKey = `smoke-approval-${Date.now()}`;
  const ticket = await requestJson<TicketResponse>(`${baseUrl}/api/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      user_email: "user@acme.com",
      message: "Please add me to the finance group"
    })
  });

  console.log(`Created ticket ${ticket.ticketId}`);

  const approval = await pollForApproval(ticket.ticketId);
  console.log(`Found approval ${approval.id}`);

  await requestJson(`${baseUrl}/api/approvals/${approval.id}/decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-operator-key": operatorKey,
      "x-tenant-id": tenantId
    },
    body: JSON.stringify({
      decision: "approve",
      reviewerIdentity: "Smoke Test",
      comment: "Automated smoke approval"
    })
  });

  const resolvedTicket = await pollForResolution(ticket.ticketId);
  console.log(`Ticket ${resolvedTicket.id} resolved`);

  const audit = await requestJson<AuditResponse>(`${baseUrl}/api/audit/${ticket.ticketId}`, {
    headers: {
      "x-api-key": apiKey,
      "x-tenant-id": tenantId
    }
  });

  const requiredEvents = ["APPROVAL_REQUESTED", "EXECUTION_COMPLETED"];

  for (const eventType of requiredEvents) {
    if (!audit.events.some((event) => event.eventType === eventType)) {
      throw new Error(`Missing audit event ${eventType}`);
    }
  }

  console.log("Approval smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
