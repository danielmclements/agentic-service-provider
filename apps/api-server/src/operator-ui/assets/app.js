(function () {
  const storageKey = "asp-operator-console";
  const scenarios = {
    unlock: "I am locked out of my account and need help getting back in.",
    reset: "Please reset my password so I can access my account.",
    group: "Please add me to the finance group for month-end reporting.",
    unsafe: "Disable my MFA so I can log in from my new phone."
  };

  const state = {
    selectedTicketId: null
  };

  const els = {
    configForm: document.getElementById("config-form"),
    ticketForm: document.getElementById("ticket-form"),
    refreshButton: document.getElementById("refresh-button"),
    ticketMessage: document.getElementById("ticket-message"),
    ticketEmail: document.getElementById("ticket-email"),
    ticketResult: document.getElementById("ticket-result"),
    metricsGrid: document.getElementById("metrics-grid"),
    roiGrid: document.getElementById("roi-grid"),
    businessNarrative: document.getElementById("business-narrative"),
    demoSummary: document.getElementById("demo-summary"),
    demoStory: document.getElementById("demo-story"),
    approvalsList: document.getElementById("approvals-list"),
    ticketsList: document.getElementById("tickets-list"),
    auditList: document.getElementById("audit-list"),
    auditHeading: document.getElementById("audit-heading"),
    detailList: document.getElementById("detail-list"),
    detailHeading: document.getElementById("detail-heading"),
    lastRefresh: document.getElementById("last-refresh"),
    apiBaseUrl: document.getElementById("api-base-url"),
    tenantId: document.getElementById("tenant-id"),
    apiKey: document.getElementById("api-key"),
    operatorKey: document.getElementById("operator-key")
  };

  function loadConfig() {
    const saved = window.localStorage.getItem(storageKey);

    if (!saved) {
      return {
        apiBaseUrl: "http://localhost:4000",
        tenantId: "acme",
        apiKey: "dev-api-key",
        operatorKey: "dev-operator-key"
      };
    }

    try {
      return JSON.parse(saved);
    } catch (_error) {
      return {
        apiBaseUrl: "http://localhost:4000",
        tenantId: "acme",
        apiKey: "dev-api-key",
        operatorKey: "dev-operator-key"
      };
    }
  }

  function saveConfig(config) {
    window.localStorage.setItem(storageKey, JSON.stringify(config));
  }

  function getConfig() {
    return {
      apiBaseUrl: els.apiBaseUrl.value.trim().replace(/\/$/, ""),
      tenantId: els.tenantId.value.trim(),
      apiKey: els.apiKey.value.trim(),
      operatorKey: els.operatorKey.value.trim()
    };
  }

  function setConfig(config) {
    els.apiBaseUrl.value = config.apiBaseUrl;
    els.tenantId.value = config.tenantId;
    els.apiKey.value = config.apiKey;
    els.operatorKey.value = config.operatorKey;
  }

  function formatDate(value) {
    return new Date(value).toLocaleString();
  }

  function statusClass(status) {
    if (["RESOLVED", "SUCCEEDED", "APPROVED", "COMPLETED"].includes(status)) {
      return "badge-success";
    }

    if (["WAITING_APPROVAL", "PENDING", "REQUIRES_APPROVAL", "EXECUTING"].includes(status)) {
      return "badge-warning";
    }

    if (["FAILED", "BLOCKED", "REJECTED"].includes(status)) {
      return "badge-danger";
    }

    if (["AUTO_EXECUTE", "LOW", "MEDIUM", "HIGH"].includes(status)) {
      return "badge-signal";
    }

    return "badge-neutral";
  }

  function badge(text) {
    const className = statusClass(text);
    return `<span class="badge ${className}">${text}</span>`;
  }

  async function apiFetch(path, kind, options) {
    const config = getConfig();
    const headers = new Headers(options && options.headers ? options.headers : {});

    if (kind === "operator") {
      headers.set("x-operator-key", config.operatorKey);
      headers.set("x-tenant-id", config.tenantId);
    } else {
      headers.set("x-api-key", config.apiKey);
      headers.set("x-tenant-id", config.tenantId);
    }

    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    return response.json();
  }

  function renderMetrics(metrics) {
    const cards = [
      {
        label: "Automation Rate",
        value: `${metrics.automation.automationRatePct}%`,
        subtext: `${metrics.automation.autoExecuted} of ${metrics.totals.actionRequests} requests auto-executed`
      },
      {
        label: "Approval Rate",
        value: `${metrics.automation.approvalRatePct}%`,
        subtext: `${metrics.totals.approvals} approvals created`
      },
      {
        label: "Success Rate",
        value: `${metrics.outcomes.successRatePct}%`,
        subtext: `${metrics.outcomes.succeeded} successful actions`
      },
      {
        label: "Avg Resolution",
        value: `${metrics.operations.avgResolutionSeconds}s`,
        subtext: `${metrics.operations.openApprovals} approvals still open`
      }
    ];

    const roiCards = [
      {
        label: "Minutes Saved",
        value: `${metrics.roi.estimatedMinutesSaved}m`,
        subtext: `${metrics.roi.estimatedHoursSaved}h of operator capacity returned`
      },
      {
        label: "Manual Baseline",
        value: `${metrics.roi.estimatedManualMinutes}m`,
        subtext: "Estimated manual effort for the same workload"
      },
      {
        label: "Platform Touch",
        value: `${metrics.roi.estimatedPlatformTouchMinutes}m`,
        subtext: "Estimated human touch with this platform in the loop"
      },
      {
        label: "Approval SLA",
        value: `${metrics.operations.avgApprovalDecisionSeconds}s`,
        subtext: "Average time to approval decision on completed approvals"
      }
    ];

    els.metricsGrid.innerHTML = cards
      .map(
        (card) => `
          <article class="metric-card">
            <p class="metric-label">${card.label}</p>
            <p class="metric-value">${card.value}</p>
            <p class="metric-subtext">${card.subtext}</p>
          </article>
        `
      )
      .join("");

    els.roiGrid.innerHTML = roiCards
      .map(
        (card) => `
          <article class="metric-card">
            <p class="metric-label">${card.label}</p>
            <p class="metric-value">${card.value}</p>
            <p class="metric-subtext">${card.subtext}</p>
          </article>
        `
      )
      .join("");

    els.businessNarrative.innerHTML = metrics.businessCase.valueNarrative
      .map((item) => `<div class="narrative-item">${item}</div>`)
      .join("");

    els.demoSummary.innerHTML = `
      <article class="demo-card">
        <p class="metric-label">Manual Queue Baseline</p>
        <p class="metric-value">${metrics.demoMode.baseline.manualQueueMinutes}m</p>
        <p class="metric-subtext">Estimated manual time for the current workload.</p>
      </article>
      <article class="demo-card">
        <p class="metric-label">Platform-Assisted Queue</p>
        <p class="metric-value">${metrics.demoMode.baseline.platformQueueMinutes}m</p>
        <p class="metric-subtext">Estimated human touch with automation and approvals applied.</p>
      </article>
    `;

    els.demoStory.innerHTML = metrics.demoMode.storyBeats
      .map((item, index) => `<div class="narrative-item"><strong>Step ${index + 1}:</strong> ${item}</div>`)
      .join("");
  }

  function renderApprovals(approvals) {
    if (!approvals.length) {
      els.approvalsList.innerHTML = `<div class="empty-state">No pending approvals. The queue is clear.</div>`;
      return;
    }

    els.approvalsList.innerHTML = approvals
      .map(
        (approval) => `
          <article class="approval-card">
            <div class="card-topline">
              ${badge(approval.riskLevel)}
              ${badge(approval.actionType)}
              ${badge(approval.ticketStatus)}
            </div>
            <h3 class="card-title">${approval.userEmail}</h3>
            <p class="ticket-message">${approval.message}</p>
            <p class="approval-comment">Created ${formatDate(approval.createdAt)} • Queue age ${approval.queueAgeSeconds}s</p>
            <p class="approval-comment">Reasoning: ${approval.triageRationale || "No rationale recorded."}</p>
            <div class="approval-actions">
              <button class="button button-approve" type="button" data-approval-id="${approval.id}" data-decision="approve">Approve</button>
              <button class="button button-reject" type="button" data-approval-id="${approval.id}" data-decision="reject">Reject</button>
              <button class="button button-ghost" type="button" data-ticket-id="${approval.ticketId}">View Audit</button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderTickets(tickets) {
    if (!tickets.length) {
      els.ticketsList.innerHTML = `<div class="empty-state">No tickets yet. Submit a scenario to get the workflow moving.</div>`;
      return;
    }

    els.ticketsList.innerHTML = tickets
      .map(
        (ticket) => `
          <article class="ticket-card">
            <div class="ticket-meta">
              ${badge(ticket.status)}
              ${ticket.triageAction ? badge(ticket.triageAction) : ""}
              ${ticket.policyDecision ? badge(ticket.policyDecision) : ""}
              ${ticket.riskLevel ? badge(ticket.riskLevel) : ""}
            </div>
            <h3 class="card-title">${ticket.userEmail}</h3>
            <p class="ticket-message">${ticket.message}</p>
            <p class="approval-comment">Created ${formatDate(ticket.createdAt)} • Updated ${formatDate(ticket.updatedAt)}</p>
            <p class="approval-comment">Reasoning: ${ticket.triageRationale || "No rationale recorded."}</p>
            <div class="ticket-actions">
              <button class="button button-secondary" type="button" data-ticket-id="${ticket.id}">Inspect Audit</button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderAudit(events, ticketId) {
    els.auditHeading.textContent = ticketId ? `Audit for ticket ${ticketId}` : "Choose a ticket to load events.";

    if (!events.length) {
      els.auditList.innerHTML = `<div class="empty-state">No audit events loaded yet.</div>`;
      return;
    }

    els.auditList.innerHTML = events
      .map(
        (event) => `
          <article class="timeline-event">
            <div class="timeline-meta">
              ${badge(event.eventType)}
              ${badge(event.actor)}
              <span>${formatDate(event.createdAt)}</span>
            </div>
            <pre class="timeline-payload">${JSON.stringify(event.payload, null, 2)}</pre>
          </article>
        `
      )
      .join("");
  }

  async function loadAudit(ticketId) {
    state.selectedTicketId = ticketId;
    const data = await apiFetch(`/api/audit/${ticketId}`, "api");
    renderAudit(data.events, ticketId);
  }

  function renderDetail(ticket) {
    const actionRequest = ticket.actionRequests && ticket.actionRequests[0] ? ticket.actionRequests[0] : null;
    const approval = actionRequest && actionRequest.approval ? actionRequest.approval : null;
    const executionRun = ticket.executionRuns && ticket.executionRuns[0] ? ticket.executionRuns[0] : null;

    els.detailHeading.textContent = `Ticket ${ticket.id}`;
    els.detailList.innerHTML = `
      <article class="detail-card">
        <div class="detail-grid">
          <div class="detail-item">
            <p class="detail-label">User</p>
            <p class="detail-value">${ticket.userEmail}</p>
          </div>
          <div class="detail-item">
            <p class="detail-label">Ticket Status</p>
            <p class="detail-value">${ticket.status}</p>
          </div>
          <div class="detail-item">
            <p class="detail-label">Intent</p>
            <p class="detail-value">${ticket.triageIntent || "Not classified"}</p>
          </div>
          <div class="detail-item">
            <p class="detail-label">Recommended Action</p>
            <p class="detail-value">${ticket.triageAction || "No action"}</p>
          </div>
          <div class="detail-item">
            <p class="detail-label">Confidence</p>
            <p class="detail-value">${ticket.triageConfidence ?? "n/a"}</p>
          </div>
          <div class="detail-item">
            <p class="detail-label">Workflow Step</p>
            <p class="detail-value">${executionRun ? executionRun.currentStep || executionRun.status : "No workflow"}</p>
          </div>
        </div>
        <div class="detail-block">
          <p class="detail-label">Request</p>
          <p class="detail-value">${ticket.message}</p>
        </div>
        <div class="detail-block">
          <p class="detail-label">Triage Rationale</p>
          <p class="detail-value">${ticket.triageRationale || "No rationale recorded."}</p>
        </div>
        <div class="detail-block">
          <p class="detail-label">Policy Outcome</p>
          <p class="detail-value">
            ${actionRequest ? `${actionRequest.policyDecision} • ${actionRequest.riskLevel} • ${actionRequest.status}` : "No action request created."}
          </p>
        </div>
        <div class="detail-block">
          <p class="detail-label">Approval</p>
          <p class="detail-value">
            ${approval ? `${approval.status}${approval.reviewerIdentity ? ` by ${approval.reviewerIdentity}` : ""}` : "Not required"}
          </p>
        </div>
        <div class="detail-block">
          <p class="detail-label">Execution Result</p>
          <pre class="timeline-payload">${JSON.stringify(actionRequest ? actionRequest.outputPayload : null, null, 2)}</pre>
        </div>
      </article>
    `;
  }

  async function loadTicketDetail(ticketId) {
    const data = await apiFetch(`/api/tickets/${ticketId}`, "api");
    renderDetail(data.ticket);
  }

  async function loadDashboard() {
    try {
      const [summary, metrics] = await Promise.all([
        apiFetch("/api/operator-summary", "operator"),
        apiFetch("/api/business-metrics", "operator")
      ]);

      renderMetrics(metrics);
      renderApprovals(summary.pendingApprovals);
      renderTickets(summary.recentTickets);
      els.lastRefresh.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;

      if (state.selectedTicketId) {
        await loadAudit(state.selectedTicketId);
        await loadTicketDetail(state.selectedTicketId);
      } else if (summary.recentTickets[0]) {
        await loadAudit(summary.recentTickets[0].id);
        await loadTicketDetail(summary.recentTickets[0].id);
      } else {
        renderAudit([], null);
        els.detailList.innerHTML = `<div class="empty-state">Choose a ticket to inspect the decision path.</div>`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      els.ticketResult.textContent = `Unable to refresh dashboard:\n${message}`;
    }
  }

  async function submitTicket(event) {
    event.preventDefault();

    const config = getConfig();
    const body = {
      tenant_id: config.tenantId,
      user_email: els.ticketEmail.value.trim(),
      message: els.ticketMessage.value.trim()
    };

    try {
      const response = await fetch(`${config.apiBaseUrl}/api/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "idempotency-key": `operator-ui-${Date.now()}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      els.ticketResult.textContent = JSON.stringify(data, null, 2);
      await loadDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      els.ticketResult.textContent = `Ticket submission failed:\n${message}`;
    }
  }

  async function decideApproval(approvalId, decision) {
    const reviewerIdentity = window.prompt("Reviewer identity", "Operator Console");

    if (!reviewerIdentity) {
      return;
    }

    const comment = window.prompt(
      decision === "approve" ? "Approval comment" : "Rejection comment",
      decision === "approve" ? "Approved from operator console" : "Rejected from operator console"
    );

    try {
      await apiFetch(`/api/approvals/${approvalId}/decision`, "operator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          decision,
          reviewerIdentity,
          comment: comment || undefined
        })
      });

      await loadDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      window.alert(`Approval action failed:\n${message}`);
    }
  }

  function handleTicketScenarios(event) {
    const button = event.target.closest("[data-scenario]");

    if (!button) {
      return;
    }

    const scenario = button.getAttribute("data-scenario");

    if (scenario && scenarios[scenario]) {
      els.ticketMessage.value = scenarios[scenario];
    }
  }

  function handleListActions(event) {
    const approvalButton = event.target.closest("[data-approval-id]");

    if (approvalButton) {
      decideApproval(
        approvalButton.getAttribute("data-approval-id"),
        approvalButton.getAttribute("data-decision")
      );
      return;
    }

    const ticketButton = event.target.closest("[data-ticket-id]");

    if (ticketButton) {
      const ticketId = ticketButton.getAttribute("data-ticket-id");
      loadAudit(ticketId);
      loadTicketDetail(ticketId);
    }
  }

  function init() {
    setConfig(loadConfig());
    els.configForm.addEventListener("submit", function (event) {
      event.preventDefault();
      saveConfig(getConfig());
      loadDashboard();
    });
    els.ticketForm.addEventListener("submit", submitTicket);
    els.refreshButton.addEventListener("click", loadDashboard);
    document.addEventListener("click", handleTicketScenarios);
    els.approvalsList.addEventListener("click", handleListActions);
    els.ticketsList.addEventListener("click", handleListActions);
    loadDashboard();
    window.setInterval(loadDashboard, 15000);
  }

  init();
})();
