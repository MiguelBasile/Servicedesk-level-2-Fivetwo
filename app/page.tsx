"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Severity = "low" | "medium" | "high" | "critical";
type WatchStatus = "at-risk" | "breached";
type DashboardState = "normal" | "sla" | "major";
type SessionStatus = "checking" | "ready" | "signin" | "unauthorized" | "unconfigured" | "local";

type Metrics = {
  majorIncidentsOpen: number;
  breachedSla: number;
  atRiskSla: number;
  p1Open: number;
  totalOpen: number;
  unassigned: number;
  blockedOpen: number;
  closedThisMonth: number;
};

type Incident = {
  severity: Severity;
  title: string;
  state: string;
  assignee: string;
  customer: string;
  updateInterval: string;
};

type WatchItem = {
  status: WatchStatus;
  title: string;
  assignee: string;
  remaining: string;
};

type Overview = {
  metrics: Metrics;
  incidents: Incident[];
  slaWatch: WatchItem[];
  scope?: {
    displayName: string;
    mode: string;
  };
};

type SessionPayload = {
  authenticated: boolean;
  allowed: boolean;
  reason?: string;
  user?: {
    userDetails: string;
    identityProvider?: string;
  };
  scope?: {
    displayName: string;
    mode: string;
  };
  scopeConfigured?: boolean;
};

const snapshots: Record<string, Overview> = {
  steady: {
    metrics: {
      majorIncidentsOpen: 0,
      breachedSla: 0,
      atRiskSla: 1,
      p1Open: 0,
      totalOpen: 14,
      unassigned: 2,
      blockedOpen: 1,
      closedThisMonth: 47
    },
    incidents: [
      {
        severity: "medium",
        title: "VPN capacity warning",
        state: "Investigating",
        assignee: "Platform Support",
        customer: "FiveTwo Internal",
        updateInterval: "Next update 30m"
      },
      {
        severity: "low",
        title: "Printer queue delay",
        state: "Waiting on Customer",
        assignee: "Facilities",
        customer: "FiveTwo Internal",
        updateInterval: "Customer pending"
      },
      {
        severity: "low",
        title: "Laptop build request queue",
        state: "In Progress",
        assignee: "Service Desk",
        customer: "FiveTwo Internal",
        updateInterval: "Today"
      }
    ],
    slaWatch: [
      {
        status: "at-risk",
        title: "Backup verification for internal servers",
        assignee: "Support Team",
        remaining: "42m left"
      }
    ],
    scope: { displayName: "FiveTwo Internal", mode: "demo" }
  },
  sla: {
    metrics: {
      majorIncidentsOpen: 0,
      breachedSla: 2,
      atRiskSla: 3,
      p1Open: 1,
      totalOpen: 22,
      unassigned: 4,
      blockedOpen: 2,
      closedThisMonth: 49
    },
    incidents: [
      {
        severity: "high",
        title: "Finance app authentication failures",
        state: "Investigating",
        assignee: "Identity Team",
        customer: "FiveTwo Internal",
        updateInterval: "SLA breached"
      },
      {
        severity: "high",
        title: "Service desk P2 response overdue",
        state: "New",
        assignee: "Unassigned",
        customer: "FiveTwo Internal",
        updateInterval: "Owner required"
      },
      {
        severity: "medium",
        title: "VPN connectivity issues for remote staff",
        state: "Investigating",
        assignee: "Network Team",
        customer: "FiveTwo Internal",
        updateInterval: "Next update 20m"
      }
    ],
    slaWatch: [
      {
        status: "breached",
        title: "Finance app authentication failures",
        assignee: "Identity Team",
        remaining: "18m overdue"
      },
      {
        status: "breached",
        title: "Service desk P2 response overdue",
        assignee: "Unassigned",
        remaining: "12m overdue"
      },
      {
        status: "at-risk",
        title: "VPN connectivity issues for remote staff",
        assignee: "Network Team",
        remaining: "24m left"
      }
    ],
    scope: { displayName: "FiveTwo Internal", mode: "demo" }
  },
  major: {
    metrics: {
      majorIncidentsOpen: 1,
      breachedSla: 4,
      atRiskSla: 2,
      p1Open: 3,
      totalOpen: 31,
      unassigned: 5,
      blockedOpen: 4,
      closedThisMonth: 50
    },
    incidents: [
      {
        severity: "critical",
        title: "Core ERP system unavailable across all sites",
        state: "Major Incident Declared",
        assignee: "Support Lead",
        customer: "FiveTwo Internal",
        updateInterval: "Updates every 30m"
      },
      {
        severity: "high",
        title: "Customer portal degraded",
        state: "Investigating",
        assignee: "Platform Support",
        customer: "FiveTwo Internal",
        updateInterval: "Bridge active"
      },
      {
        severity: "high",
        title: "Service desk P2 response overdue",
        state: "New",
        assignee: "Unassigned",
        customer: "FiveTwo Internal",
        updateInterval: "Escalated"
      }
    ],
    slaWatch: [
      {
        status: "breached",
        title: "Core ERP system unavailable across all sites",
        assignee: "Support Lead",
        remaining: "Major incident active"
      },
      {
        status: "breached",
        title: "Customer portal degraded",
        assignee: "Platform Support",
        remaining: "31m overdue"
      },
      {
        status: "at-risk",
        title: "Network outage follow-up tasks",
        assignee: "Network Team",
        remaining: "19m left"
      }
    ],
    scope: { displayName: "FiveTwo Internal", mode: "demo" }
  }
};

const snapshotLabels = [
  ["steady", "Steady State"],
  ["sla", "SLA Breach"],
  ["major", "Major Incident"]
] as const;

export default function DashboardPage() {
  const [timeLabel, setTimeLabel] = useState("--:--");
  const [dateLabel, setDateLabel] = useState("--");
  const [lastUpdated, setLastUpdated] = useState("Live");
  const [overview, setOverview] = useState<Overview>(snapshots.steady);
  const [activeSnapshot, setActiveSnapshot] = useState<string | undefined>("steady");
  const [dataSource, setDataSource] = useState("Demo data");
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");
  const [session, setSession] = useState<SessionPayload | undefined>();

  const dashboardState = getAlertState(overview.metrics);
  const statusCopy = getStatusCopy(overview.metrics);

  const loadOverview = useCallback(async () => {
    try {
      const response = await fetch("/api/ado/overview", { cache: "no-store" });
      const payload = (await response.json()) as Partial<Overview> & { error?: string; message?: string };

      if (!response.ok || !payload.metrics || !payload.incidents || !payload.slaWatch) {
        setDataSource(payload.message || payload.error ? `Demo data - ${payload.message || payload.error}` : "Demo data");
        return;
      }

      setOverview(payload as Overview);
      setDataSource("Azure DevOps live");
      setActiveSnapshot(undefined);
    } catch {
      setDataSource("Demo data - API unavailable");
    }
  }, []);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setDateLabel(
        now.toLocaleDateString(undefined, {
          weekday: "long",
          day: "2-digit",
          month: "short",
          year: "numeric"
        })
      );
      setTimeLabel(
        now.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit"
        })
      );
      setLastUpdated(
        `Updated ${now.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit"
        })}`
      );
    }

    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (response.status === 404) {
          if (!cancelled) setSessionStatus("local");
          return;
        }

        const payload = (await response.json()) as SessionPayload;
        if (cancelled) return;

        setSession(payload);
        if (!payload.authenticated) {
          setSessionStatus("signin");
          return;
        }

        if (!payload.allowed) {
          setSessionStatus("unauthorized");
          return;
        }

        if (!payload.scopeConfigured) {
          setSessionStatus("unconfigured");
          return;
        }

        setSessionStatus("ready");
        await loadOverview();
      } catch {
        if (!cancelled) setSessionStatus("local");
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

  useEffect(() => {
    if (sessionStatus !== "ready") return;
    const timer = window.setInterval(loadOverview, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadOverview, sessionStatus]);

  const summaryRows = useMemo(() => buildSummaryRows(overview.metrics), [overview.metrics]);
  const scopeLabel = session?.scope?.displayName || overview.scope?.displayName || "FiveTwo Internal";

  function setSnapshot(snapshotName: string) {
    setOverview(snapshots[snapshotName] ?? snapshots.steady);
    setActiveSnapshot(snapshotName);
    setDataSource("Demo data");
  }

  return (
    <main className={`dashboard state-${dashboardState}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Service Desk Level 2</p>
          <h1>Service Health Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <a className="signout-link" href="/logout">
            Sign out
          </a>
          <div className="clock">
            <span>{dateLabel}</span>
            <strong>{timeLabel}</strong>
          </div>
        </div>
      </header>

      <AccessBanner sessionStatus={sessionStatus} session={session} />

      <section className="status-banner" aria-live="polite">
        <div>
          <p className="eyebrow">Current Status</p>
          <h2>{statusCopy.title}</h2>
          <p>{statusCopy.message}</p>
        </div>
        <div className="status-stack">
          <div className="status-pill">{statusCopy.pill}</div>
          <span>{dataSource}</span>
          <span>Scope: {scopeLabel}</span>
        </div>
      </section>

      <section className="control-strip" aria-label="Dashboard state controls">
        {snapshotLabels.map(([snapshotName, label]) => (
          <button
            className={`state-button ${activeSnapshot === snapshotName ? "is-active" : ""}`}
            key={snapshotName}
            type="button"
            onClick={() => setSnapshot(snapshotName)}
          >
            {label}
          </button>
        ))}
      </section>

      <section className="metric-grid" aria-label="Key metrics">
        <MetricCard
          label="Major Incidents"
          value={overview.metrics.majorIncidentsOpen}
          detail="Active ADO major incident work items"
          tone={overview.metrics.majorIncidentsOpen > 0 ? "critical" : undefined}
        />
        <MetricCard
          label="Breached SLA"
          value={overview.metrics.breachedSla}
          detail="Resolution target has passed"
          tone={overview.metrics.breachedSla > 0 ? "critical" : undefined}
        />
        <MetricCard
          label="At Risk SLA"
          value={overview.metrics.atRiskSla}
          detail="Inside final 20% of SLA time"
          tone={overview.metrics.atRiskSla > 0 ? "warning" : undefined}
        />
        <MetricCard
          label="P1 Open"
          value={overview.metrics.p1Open}
          detail="Critical priority tickets open now"
          tone={overview.metrics.p1Open > 0 ? "critical" : undefined}
        />
        <MetricCard label="Total Open" value={overview.metrics.totalOpen} detail="All open incidents and requests" />
        <MetricCard
          label="Unassigned"
          value={overview.metrics.unassigned}
          detail="Needs ownership in ADO"
          tone={overview.metrics.unassigned > 0 ? "warning" : undefined}
        />
        <MetricCard
          label="Blocked"
          value={overview.metrics.blockedOpen}
          detail="Waiting on dependency or access"
          tone={overview.metrics.blockedOpen > 0 ? "warning" : undefined}
        />
        <MetricCard label="Closed This Month" value={overview.metrics.closedThisMonth} detail="Resolved or closed work items" />
      </section>

      <section className="content-grid">
        <article className="panel incident-panel">
          <div className="panel-heading">
            <h3>Incident Board</h3>
            <span>{overview.incidents.length} visible</span>
          </div>
          <div className="incident-list">
            {overview.incidents.map((incident) => (
              <div className="incident-item" key={`${incident.title}-${incident.state}`}>
                <span className={`incident-severity sev-${incident.severity}`}>{incident.severity}</span>
                <div>
                  <strong>{incident.title}</strong>
                  <p>
                    {incident.state} &middot; {incident.customer} &middot; {incident.assignee}
                  </p>
                </div>
                <span className="incident-time">{incident.updateInterval}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h3>SLA Watch</h3>
            <span>
              {overview.slaWatch.length} item{overview.slaWatch.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="watch-list">
            {overview.slaWatch.map((item) => (
              <div className="watch-row" key={`${item.title}-${item.remaining}`}>
                <span className={`watch-badge ${item.status}`}>{item.status}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>
                    {item.assignee} &middot; {item.remaining}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel oncall-panel">
          <div className="panel-heading">
            <h3>Office Summary</h3>
            <span>{lastUpdated}</span>
          </div>
          <div className="summary-list">
            {summaryRows.map((row) => (
              <div className="summary-row" key={row.label}>
                <span className={`summary-badge ${row.level}`}>{row.level}</span>
                <div>
                  <strong>{row.label}</strong>
                  <p>{row.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function AccessBanner({
  sessionStatus,
  session
}: {
  sessionStatus: SessionStatus;
  session: SessionPayload | undefined;
}) {
  if (sessionStatus === "ready" || sessionStatus === "local") return null;

  const copy: Record<Exclude<SessionStatus, "ready" | "local">, { title: string; body: string; action?: string }> = {
    checking: {
      title: "Checking access",
      body: "Validating your Static Web Apps sign-in and dashboard scope."
    },
    signin: {
      title: "Sign in required",
      body: "Redirecting through Static Web Apps Entra authentication.",
      action: "Sign in"
    },
    unauthorized: {
      title: "Access not authorized",
      body: `${session?.user?.userDetails || "This account"} is not allowlisted for this dashboard.`
    },
    unconfigured: {
      title: "Dashboard scope not configured",
      body: "Your account is allowlisted, but no customer scope is mapped."
    }
  };
  const selected = copy[sessionStatus];

  return (
    <section className={`access-banner access-${sessionStatus}`} aria-live="polite">
      <div>
        <p className="eyebrow">Access</p>
        <h2>{selected.title}</h2>
        <p>{selected.body}</p>
      </div>
      {selected.action ? (
        <a className="access-action" href="/login">
          {selected.action}
        </a>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "warning" | "critical";
}) {
  return (
    <article className={`metric-card ${tone === "warning" ? "is-warning" : ""} ${tone === "critical" ? "is-critical" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function getAlertState(metrics: Metrics): DashboardState {
  if (metrics.majorIncidentsOpen > 0) return "major";
  if (metrics.breachedSla > 0) return "sla";
  return "normal";
}

function getStatusCopy(metrics: Metrics) {
  const alertState = getAlertState(metrics);

  if (alertState === "major") {
    return {
      title: "Major Incident",
      message: "A major incident is active in Azure DevOps.",
      pill: "Major Incident"
    };
  }

  if (alertState === "sla") {
    return {
      title: "SLA Breach",
      message: "One or more Azure DevOps tickets are over SLA.",
      pill: "Over SLA"
    };
  }

  return {
    title: "Operational",
    message: "No major incidents and no breached SLAs are currently active.",
    pill: "Normal"
  };
}

function buildSummaryRows(metrics: Metrics) {
  return [
    {
      level: metrics.majorIncidentsOpen > 0 ? "critical" : "normal",
      label: "Major incident watch",
      detail:
        metrics.majorIncidentsOpen > 0
          ? `${metrics.majorIncidentsOpen} active major incident in ADO`
          : "No active major incidents"
    },
    {
      level: metrics.breachedSla > 0 ? "critical" : metrics.atRiskSla > 0 ? "warning" : "normal",
      label: "SLA posture",
      detail:
        metrics.breachedSla > 0
          ? `${metrics.breachedSla} breached, ${metrics.atRiskSla} at risk`
          : `${metrics.atRiskSla} at risk, none breached`
    },
    {
      level: metrics.unassigned > 0 || metrics.blockedOpen > 0 ? "warning" : "normal",
      label: "Queue hygiene",
      detail: `${metrics.unassigned} unassigned, ${metrics.blockedOpen} blocked`
    }
  ];
}
