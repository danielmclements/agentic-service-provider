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

  const permissionLabels = {
    "tickets:read": "Ticket Read",
    "tickets:submit": "Ticket Submit",
    "approvals:read": "Approval Read",
    "approvals:decide": "Approval Decide",
    "audit:read": "Audit Read",
    "connectors:admin": "Connector Admin",
    "tenants:admin": "Tenant Admin",
    "memberships:read": "Membership Read",
    "memberships:write": "Membership Write"
  };

  const els = {
    ticketForm: document.getElementById("ticket-form"),
    submitTicketButton: document.getElementById("submit-ticket-button"),
    composePermissionNote: document.getElementById("compose-permission-note"),
    refreshButton: document.getElementById("refresh-button"),
    logoutButton: document.getElementById("logout-button"),
    loginLink: document.getElementById("login-link"),
    ticketMessage: document.getElementById("ticket-message"),
    ticketEmail: document.getElementById("ticket-email"),
    ticketResult: document.getElementById("ticket-result"),
    pulseGrid: document.getElementById("pulse-grid"),
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
    sessionGlobalRoles: document.getElementById("session-global-roles"),
    sessionPermissions: document.getElementById("session-permissions"),
    sessionRoles: document.getElementById("session-roles"),
    sessionMfa: document.getElementById("session-mfa"),
    sessionAssurance: document.getElementById("session-assurance"),
    tenantSwitcher: document.getElementById("tenant-switcher"),
    tenantSwitchButton: document.getElementById("tenant-switch-button"),
    membershipsList: document.getElementById("memberships-list"),
    authBanner: document.getElementById("auth-banner"),
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

  function hasPermission(permission) {
    return Boolean(state.session && Array.isArray(state.session.permissions) && state.session.permissions.includes(permission));
  }

  function hasGlobalRole(role) {
    return Boolean(state.session && Array.isArray(state.session.globalRoles) && state.session.globalRoles.includes(role));
  }

  function isMfaFresh() {
    return Boolean(state.session && state.session.amr.includes("mfa") && state.session.mfaFreshUntil * 1000 > Date.now());
  }

  function formatPermission(permission) {
    return permissionLabels[permission] || permission;
  }

  function chipList(values, options) {
    if (!values || !values.length) {
      return `<span class="badge badge-neutral">${options.emptyLabel}</span>`;
    }

    return values
      .map((value) => `<span class="badge ${options.className || "badge-neutral"}">${options.mapValue ? options.mapValue(value) : value}</span>`)
      .join("");
  }

  function callout(type, title, body) {
    return `
      <div class="callout callout-${type}">
        <p class="callout-title">${title}</p>
        <p class="callout-copy">${body}</p>
      </div>
    `;
  }

  function setAuthBanner(type, title, text, chips) {
    els.authBanner.className = `auth-banner auth-banner-${type}`;
    els.authBanner.innerHTML = `
      <div class="auth-banner-copy">
        <p class="auth-banner-title">${title}</p>
        <p class="auth-banner-text">${text}</p>
      </div>
      <div class="auth-banner-meta">${chips || ""}</div>
    `;
  }

  function renderSessionState(authenticated) {
    if (!authenticated) {
      els.sessionUser.textContent = "Not signed in";
      els.sessionTenant.textContent = "Sign in required";
      els.sessionGlobalRoles.innerHTML = chipList([], { emptyLabel: "No global roles" });
      els.sessionRoles.innerHTML = chipList([], { emptyLabel: "No roles" });
      els.sessionPermissions.innerHTML = chipList([], { emptyLabel: "No permissions" });
      els.sessionMfa.textContent = "No session";
      els.tenantSwitcher.innerHTML = `<option value="">Sign in required</option>`;
      els.tenantSwitchButton.disabled = true;
      els.sessionAssurance.className = "status-panel status-panel-warning";
      els.sessionAssurance.innerHTML = `
        <p class="status-title">Authentication required</p>
        <p class="status-copy">Sign in with Auth0 to load your tenant, policies, and operator actions.</p>
      `;
      els.composePermissionNote.textContent = "Sign in to submit tickets or review the operator queue.";
      els.submitTicketButton.disabled = true;
      setAuthBanner("warning", "Sign in to open the control plane", "The console is ready, but live tenant data and protected actions require an authenticated operator session.");
    }
  }

  function renderAuthenticatedSession(session) {
    const freshMfa = isMfaFresh();
    const authChips = [
      `<span class="badge badge-signal">${session.tenantSlug}</span>`,
      `<span class="badge ${freshMfa ? "badge-success" : "badge-warning"}">${freshMfa ? "Fresh MFA" : "Step-up needed"}</span>`,
      `<span class="badge badge-neutral">${session.roles.length} role${session.roles.length === 1 ? "" : "s"}</span>`
    ].join("");

    els.sessionUser.textContent = session.displayName || session.email || session.userId;
    els.sessionTenant.textContent = `${session.tenantName} (${session.tenantSlug})`;
    els.sessionGlobalRoles.innerHTML = chipList(session.globalRoles, { emptyLabel: "No global roles", className: "badge-warning" });
    els.sessionRoles.innerHTML = chipList(session.roles, { emptyLabel: "No roles", className: "badge-signal" });
    els.sessionPermissions.innerHTML = chipList(session.permissions, {
      emptyLabel: "No permissions",
      className: "badge-neutral",
      mapValue: formatPermission
    });
    els.sessionMfa.textContent = session.amr.includes("mfa")
      ? `${freshMfa ? "Fresh through" : "Expired at"} ${formatDate(session.mfaFreshUntil * 1000)}`
      : "No MFA claim present";
    els.sessionAssurance.className = `status-panel ${freshMfa ? "status-panel-success" : "status-panel-warning"}`;
    els.sessionAssurance.innerHTML = `
      <p class="status-title">${freshMfa ? "Approval-ready session" : "Approval step-up required"}</p>
      <p class="status-copy">${
        freshMfa
          ? "This operator session can make approval decisions without re-authenticating."
          : "Read access is live, but approval decisions will prompt for fresh MFA before they can continue."
      }</p>
    `;

    const bannerCopy = hasPermission("approvals:decide")
      ? freshMfa
          ? "This operator can submit tickets, inspect governance data, and decide approvals in the current session."
        : "This operator can review work now, but approval decisions will require a fresh MFA step-up."
      : "This operator can monitor the queue and governance state, but approval actions are not available in this role.";

    els.tenantSwitcher.innerHTML = (session.memberships || [])
      .map(
        (membership) =>
          `<option value="${membership.tenantId}" ${membership.tenantId === session.tenantId ? "selected" : ""}>${membership.tenantName} (${membership.tenantRole})</option>`
      )
      .join("");
    els.tenantSwitchButton.disabled = !session.memberships || session.memberships.length < 2;

    setAuthBanner("success", `Signed in as ${session.displayName || session.email || session.userId}`, bannerCopy, authChips);
  }

  function renderMemberships(memberships) {
    if (!memberships || !memberships.length) {
      els.membershipsList.innerHTML = `<div class="empty-state">No memberships are visible for this tenant.</div>`;
      return;
    }

    els.membershipsList.innerHTML = memberships
      .map(
        (membership) => `
          <article class="ticket-card">
            <div class="ticket-meta">
              ${badge(membership.tenantRole)}
              ${membership.active ? badge("ACTIVE") : badge("INACTIVE")}
            </div>
            <h3 class="card-title">${membership.displayName || membership.email || membership.userId}</h3>
            <p class="approval-comment">${membership.tenantName} • ${membership.userId}</p>
            <div class="chip-row">${chipList(membership.globalRoles || [], { emptyLabel: "No global roles", className: "badge-warning" })}</div>
            <div class="chip-row">${chipList(membership.permissions || [], { emptyLabel: "No permissions", className: "badge-neutral", mapValue: formatPermission })}</div>
          </article>
        `
      )
      .join("");
  }

  async function loadMemberships() {
    if (!state.session || (!hasPermission("memberships:read") && !hasGlobalRole("superadmin"))) {
      els.membershipsList.innerHTML = `<div class="empty-state">Membership visibility is not available in this session.</div>`;
      return;
    }

    const data = await apiFetch(`/api/memberships?tenantId=${encodeURIComponent(state.session.tenantId)}`);
    renderMemberships(data.memberships);
  }

  function updateActionAvailability() {
    const canSubmitTickets = hasPermission("tickets:submit");
    const canDecideApprovals = hasPermission("approvals:decide");
    const canReadAudit = hasPermission("audit:read");
    const governanceTab = els.tabButtons.find((button) => button.getAttribute("data-tab") === "governance");

    els.submitTicketButton.disabled = !canSubmitTickets;
    els.ticketEmail.disabled = !canSubmitTickets;
    els.ticketMessage.disabled = !canSubmitTickets;
    els.composePermissionNote.textContent = canSubmitTickets
      ? "Ticket intake is enabled for this tenant-scoped operator session."
      : "This session can observe the queue but cannot submit new tickets.";

    if (governanceTab) {
      governanceTab.disabled = !canReadAudit;
      governanceTab.title = canReadAudit ? "" : "Audit access is not available for this session.";
    }

    return { canSubmitTickets, canDecideApprovals, canReadAudit };
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
      state.session = null;
      renderSessionState(false);
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
    renderAuthenticatedSession(data.session);
    updateActionAvailability();

    return data.session;
  }

  async function switchTenant() {
    if (!state.session) {
      return;
    }

    const tenantId = els.tenantSwitcher.value;
    if (!tenantId || tenantId === state.session.tenantId) {
      return;
    }

    try {
      await apiFetch("/api/session/switch-tenant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tenantId })
      });

      await loadDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      window.alert(`Tenant switch failed:\n${message}`);
    }
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

  function renderPulse(summary, metrics) {
    const cards = [
      {
        label: "Queue Health",
        value: summary.totals.pendingApprovals ? `${summary.totals.pendingApprovals} pending` : "Clear",
        subtext: summary.totals.pendingApprovals
          ? `${summary.totals.waitingApproval} tickets are paused behind operator review.`
          : "No approvals are currently waiting on a human decision."
      },
      {
        label: "Automation Coverage",
        value: `${metrics.automation.automationRatePct}%`,
        subtext: `${metrics.automation.autoExecuted} requests resolved without operator intervention.`
      },
      {
        label: "Risk Controls",
        value: `${metrics.automation.blockedRatePct}% blocked`,
        subtext: `${summary.totals.blocked} tickets were stopped by policy before execution.`
      },
      {
        label: "Resolution Tempo",
        value: `${metrics.operations.avgResolutionSeconds}s`,
        subtext: `${metrics.outcomes.successRatePct}% success across action requests.`
      }
    ];

    els.pulseGrid.innerHTML = cards
      .map(
        (card) => `
          <article class="pulse-card">
            <p class="pulse-label">${card.label}</p>
            <p class="pulse-value">${card.value}</p>
            <p class="pulse-subtext">${card.subtext}</p>
          </article>
        `
      )
      .join("");
  }

  function renderApprovals(approvals) {
    const canDecideApprovals = hasPermission("approvals:decide");
    const freshMfa = isMfaFresh();
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
            ${
              approval.verificationStatus === "PENDING"
                ? callout("warning", "Verification still pending", "The workflow is waiting on end-user verification before an operator decision can safely move it forward.")
                : ""
            }
            ${
              !canDecideApprovals
                ? callout("neutral", "Decision permission not assigned", "This session can review the queue, but approval actions are reserved for approver-capable roles.")
                : !freshMfa
                  ? callout("warning", "Fresh MFA required", "Approving or rejecting will trigger a step-up flow so the audit trail shows recent strong assurance.")
                  : ""
            }
            <div class="approval-actions">
              <button class="button button-approve" type="button" data-approval-id="${approval.id}" data-decision="approve" ${!canDecideApprovals ? "disabled" : ""}>Approve</button>
              <button class="button button-reject" type="button" data-approval-id="${approval.id}" data-decision="reject" ${!canDecideApprovals ? "disabled" : ""}>Reject</button>
              <button class="button button-ghost" type="button" data-ticket-id="${approval.ticketId}">Inspect Flow</button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderTickets(tickets) {
    const canReadAudit = hasPermission("audit:read");

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
            ${
              ticket.verificationStatus === "PENDING"
                ? callout("warning", "Waiting on user proof", `Verification via ${ticket.verificationMethod || "configured challenge"} must complete before the run can continue.`)
                : ""
            }
            ${
              ticket.policyDecision === "BLOCK"
                ? callout("danger", "Policy blocked execution", "The workflow classified this request as unsafe under current tenant policy and did not call an integration.")
                : ""
            }
            <div class="ticket-insights">
              <div class="insight-pill">
                <span class="insight-label">Workflow</span>
                <span class="insight-value">${ticket.workflowStep || ticket.workflowStatus || "Not started"}</span>
              </div>
              <div class="insight-pill">
                <span class="insight-label">Action</span>
                <span class="insight-value">${ticket.actionStatus || "Pending classification"}</span>
              </div>
              <div class="insight-pill">
                <span class="insight-label">Confidence</span>
                <span class="insight-value">${ticket.triageConfidence ?? "n/a"}</span>
              </div>
            </div>
            <div class="ticket-actions">
              <button class="button button-secondary" type="button" data-ticket-id="${ticket.id}" ${!canReadAudit ? "disabled" : ""}>Inspect Audit</button>
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
    if (!hasPermission("audit:read")) {
      renderAudit([], null);
      return;
    }

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
        ${
          verification && verification.status === "PENDING"
            ? callout("warning", "Verification gate is active", `The workflow is holding for ${verification.method} proof until ${formatDate(verification.expiresAt)}.`)
            : ""
        }
        ${
          actionRequest && actionRequest.policyDecision === "BLOCK"
            ? callout("danger", "Action blocked before execution", "The policy engine stopped this request before any provider-side operation could run.")
            : ""
        }
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
      els.pulseGrid.innerHTML = `
        <article class="pulse-card">
          <p class="pulse-label">Workspace</p>
          <p class="pulse-value">Sign in</p>
          <p class="pulse-subtext">Authenticate to load live control coverage, queue health, and operator throughput.</p>
        </article>
      `;
      els.metricsGrid.innerHTML = "";
      els.roiGrid.innerHTML = "";
      els.businessNarrative.innerHTML = `<div class="empty-state">Sign in to load tenant metrics and queue activity.</div>`;
      els.demoSummary.innerHTML = "";
      els.demoStory.innerHTML = "";
      els.approvalsList.innerHTML = `<div class="empty-state">No approval data is available until an authenticated tenant session is loaded.</div>`;
      els.ticketsList.innerHTML = `<div class="empty-state">No ticket data is available until you sign in.</div>`;
      els.membershipsList.innerHTML = `<div class="empty-state">Sign in to inspect tenant memberships.</div>`;
      renderAudit([], null);
      els.detailList.innerHTML = `<div class="empty-state">Sign in to inspect ticket decision paths.</div>`;
      return;
    }

    try {
      const [summary, metrics] = await Promise.all([
        apiFetch("/api/operator-summary"),
        apiFetch("/api/business-metrics")
      ]);

      renderPulse(summary, metrics);
      renderMetrics(metrics);
      renderApprovals(summary.pendingApprovals);
      renderTickets(summary.recentTickets);
      await loadMemberships();
      els.lastRefresh.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;

      if (state.selectedTicketId) {
        await loadTicketDetail(state.selectedTicketId);
        await loadAudit(state.selectedTicketId);
      } else if (summary.recentTickets[0]) {
        await loadTicketDetail(summary.recentTickets[0].id);
        await loadAudit(summary.recentTickets[0].id);
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

    if (!hasPermission("tickets:submit")) {
      els.ticketResult.textContent = "Ticket submission is disabled for this session. Ask a tenant operator or admin for submit access.";
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
    if (!hasPermission("approvals:decide")) {
      window.alert("This session does not have approval decision permission.");
      return;
    }

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
      loadTicketDetail(ticketId);
      if (hasPermission("audit:read")) {
        loadAudit(ticketId);
        setActiveTab("governance");
      } else {
        renderAudit([], null);
      }
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
    els.tenantSwitchButton.addEventListener("click", switchTenant);
    document.addEventListener("click", handleTicketScenarios);
    els.approvalsList.addEventListener("click", handleListActions);
    els.ticketsList.addEventListener("click", handleListActions);
    initTabs();
    loadDashboard();
    window.setInterval(loadDashboard, 15000);
  }

  init();
})();
