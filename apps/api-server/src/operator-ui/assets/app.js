(function () {
  const scenarios = {
    unlock: "I am locked out of my account and need help getting back in.",
    reset: "Please reset my password so I can access my account.",
    group: "Please add me to the finance group for month-end reporting.",
    unsafe: "Disable my MFA so I can log in from my new phone."
  };

  const state = {
    selectedTicketId: null,
    session: null
  };

  const els = {
    ticketForm: document.getElementById("ticket-form"),
    refreshButton: document.getElementById("refresh-button"),
    logoutButton: document.getElementById("logout-button"),
    loginLink: document.getElementById("login-link"),
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
    sessionUser: document.getElementById("session-user"),
    sessionTenant: document.getElementById("session-tenant"),
    sessionPermissions: document.getElementById("session-permissions"),
    sessionMfa: document.getElementById("session-mfa"),
    queueBadge: document.getElementById("queue-badge"),
    tabButtons: Array.from(document.querySelectorAll("[data-tab]")),
    tabPanels: Array.from(document.querySelectorAll("[data-panel]"))
  };

  function formatDate(value) {
    return new Date(value).toLocaleString();
  }

  function statusClass(status) {
    if (["RESOLVED", "SUCCEEDED", "APPROVED", "COMPLETED", "VERIFIED", "BYPASSED"].includes(status)) {
      return "badge-success";
    }

    if (["WAITING_APPROVAL", "PENDING", "REQUIRES_APPROVAL", "EXECUTING", "WAITING_VERIFICATION"].includes(status)) {
      return "badge-warning";
    }

    if (["FAILED", "BLOCKED", "REJECTED", "EXPIRED"].includes(status)) {
      return "badge-danger";
    }

    if (["AUTO_EXECUTE", "LOW", "MEDIUM", "HIGH", "PUSH", "WEBAUTHN", "SMS"].includes(status)) {
      return "badge-signal";
    }

    return "badge-neutral";
  }

  function badge(text) {
    if (!text) {
      return "";
    }

    const className = statusClass(text);
    return `<span class="badge ${className}">${text}</span>`;
  }

  async function apiFetch(path, options) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options && options.headers ? options.headers : {})
      }
    });

    if (response.status === 401) {
      const payload = await response.json().catch(() => null);
      window.location.href = payload && payload.loginUrl ? payload.loginUrl : "/auth/login";
      throw new Error("Authentication required");
    }

    if (response.status === 403) {
      const payload = await response.json().catch(() => null);
      if (payload && payload.reauthenticateUrl) {
        window.alert("Fresh MFA is required before this action can continue.");
        window.location.href = payload.reauthenticateUrl;
        throw new Error("Fresh MFA required");
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    return response.json();
  }

  async function loadSession() {
    const data = await apiFetch("/api/session");

    if (!data.authenticated) {
      els.sessionUser.textContent = "Not signed in";
      els.sessionTenant.textContent = "Sign in required";
      els.sessionPermissions.textContent = "No session";
      els.sessionMfa.textContent = "No session";
      els.loginLink.hidden = false;
      els.logoutButton.hidden = true;
      if (data.loginUrl) {
        els.loginLink.href = data.loginUrl;
      }
      return null;
    }

    state.session = data.session;
    els.loginLink.hidden = true;
    els.logoutButton.hidden = false;
    els.sessionUser.textContent = data.session.displayName || data.session.email || data.session.userId;
    els.sessionTenant.textContent = `${data.session.tenantName} (${data.session.tenantSlug})`;
    els.sessionPermissions.textContent = data.session.permissions.join(", ");
    els.sessionMfa.textContent = data.session.amr.includes("mfa")
      ? `Fresh until ${formatDate(data.session.mfaFreshUntil * 1000)}`
      : "No MFA claim present";

    return data.session;
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
      <article class="metric-card">
        <p class="metric-label">Manual Queue Baseline</p>
        <p class="metric-value">${metrics.demoMode.baseline.manualQueueMinutes}m</p>
        <p class="metric-subtext">Estimated manual time for the current workload.</p>
      </article>
      <article class="metric-card">
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
    els.queueBadge.textContent = String(approvals.length);

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
              ${badge(approval.verificationStatus)}
              ${badge(approval.verificationMethod)}
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
              ${badge(ticket.triageAction)}
              ${badge(ticket.policyDecision)}
              ${badge(ticket.riskLevel)}
              ${badge(ticket.verificationStatus)}
              ${badge(ticket.verificationMethod)}
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
    const data = await apiFetch(`/api/audit/${ticketId}`);
    renderAudit(data.events, ticketId);
  }

  function renderDetail(ticket) {
    const actionRequest = ticket.actionRequests && ticket.actionRequests[0] ? ticket.actionRequests[0] : null;
    const approval = actionRequest && actionRequest.approval ? actionRequest.approval : null;
    const verification = actionRequest && actionRequest.verificationChallenge ? actionRequest.verificationChallenge : null;
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
          <p class="detail-label">Verification</p>
          <p class="detail-value">
            ${verification ? `${verification.status} via ${verification.method} until ${formatDate(verification.expiresAt)}` : "Not required"}
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
    const data = await apiFetch(`/api/tickets/${ticketId}`);
    renderDetail(data.ticket);
  }

  async function loadDashboard() {
    const session = await loadSession();
    if (!session) {
      return;
    }

    try {
      const [summary, metrics] = await Promise.all([
        apiFetch("/api/operator-summary"),
        apiFetch("/api/business-metrics")
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

    if (!state.session) {
      window.location.href = "/auth/login";
      return;
    }

    const body = {
      tenant_id: state.session.tenantId,
      user_email: els.ticketEmail.value.trim(),
      message: els.ticketMessage.value.trim()
    };

    try {
      const data = await apiFetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": `operator-ui-${Date.now()}`
        },
        body: JSON.stringify(body)
      });

      els.ticketResult.textContent = JSON.stringify(data, null, 2);
      await loadDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      els.ticketResult.textContent = `Ticket submission failed:\n${message}`;
    }
  }

  async function decideApproval(approvalId, decision) {
    const comment = window.prompt(
      decision === "approve" ? "Approval comment" : "Rejection comment",
      decision === "approve" ? "Approved from operator console" : "Rejected from operator console"
    );

    try {
      await apiFetch(`/api/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          decision,
          comment: comment || undefined
        })
      });

      await loadDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      window.alert(`Approval action failed:\n${message}`);
    }
  }

  async function logout() {
    const response = await apiFetch("/auth/logout", { method: "POST" });
    window.location.href = response.logoutUrl || "/operator";
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
      decideApproval(approvalButton.getAttribute("data-approval-id"), approvalButton.getAttribute("data-decision"));
      return;
    }

    const ticketButton = event.target.closest("[data-ticket-id]");

    if (ticketButton) {
      const ticketId = ticketButton.getAttribute("data-ticket-id");
      loadAudit(ticketId);
      loadTicketDetail(ticketId);
      setActiveTab("governance");
    }
  }

  function setActiveTab(tabName) {
    els.tabButtons.forEach((button) => {
      const active = button.getAttribute("data-tab") === tabName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });

    els.tabPanels.forEach((panel) => {
      const active = panel.getAttribute("data-panel") === tabName;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  }

  function initTabs() {
    els.tabButtons.forEach((button) => {
      button.addEventListener("click", function () {
        setActiveTab(button.getAttribute("data-tab"));
      });
    });
  }

  function init() {
    els.ticketForm.addEventListener("submit", submitTicket);
    els.refreshButton.addEventListener("click", loadDashboard);
    els.logoutButton.addEventListener("click", logout);
    document.addEventListener("click", handleTicketScenarios);
    els.approvalsList.addEventListener("click", handleListActions);
    els.ticketsList.addEventListener("click", handleListActions);
    initTabs();
    loadDashboard();
    window.setInterval(loadDashboard, 15000);
  }

  init();
})();
