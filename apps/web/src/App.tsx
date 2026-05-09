import { FormEvent, useEffect, useMemo, useState } from "react";

type Agent = {
  id: string;
  name: string;
  status: string;
  lastCheckIn?: string;
};

type MonitorCheck = {
  message?: string;
  checkedAt: string;
  sslExpiresAt?: string;
  sslSelfSigned?: boolean;
  httpMatched?: boolean | null;
  httpStatusCode?: number | null;
};

type Monitor = {
  id: string;
  friendlyName: string;
  description?: string;
  target: string;
  type: string;
  status: string;
  expectedResponse?: string | null;
  proposedResponse?: string | null;
  parentMonitor?: { friendlyName: string } | null;
  checks: MonitorCheck[];
};

type AlertSettings = {
  alertLevel: "warning" | "down";
  repeat: "none" | "always" | "status_change_only";
  delaySeconds: number;
  upDownWarningCycles: number;
  upDownDownCycles: number;
  webhookUrl?: string;
};

type AlertEvent = {
  id: string;
  monitor: { friendlyName: string };
  previousStatus: string;
  newStatus: string;
  suppressedByMonitorId?: string | null;
  notified: boolean;
  notificationError?: string | null;
  createdAt: string;
};

type AuthUser = {
  id: string;
  username: string;
  role: string;
};

type AppPage = "dashboard" | "settings";

const api = async <TResponse,>(path: string, options: RequestInit = {}): Promise<TResponse> => {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    ...options
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<TResponse>;
};

const statusPill = (status: string) => <span className={`pill ${status.toLowerCase()}`}>{status}</span>;

export const App = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [alertSettings, setAlertSettings] = useState<AlertSettings | null>(null);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [activePage, setActivePage] = useState<AppPage>("dashboard");
  const [loginError, setLoginError] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  const summary = useMemo(
    () => ({
      agents: agents.length,
      monitors: monitors.length,
      up: monitors.filter((monitor) => monitor.status === "UP").length,
      down: monitors.filter((monitor) => monitor.status === "DOWN").length,
      unknown: monitors.filter((monitor) => monitor.status === "UNKNOWN").length
    }),
    [agents, monitors]
  );

  const loadDashboard = async () => {
    const [sessionResponse, agentResponse, monitorResponse, settingsResponse, eventsResponse] = await Promise.all([
      api<{ user: AuthUser }>("/api/auth/me"),
      api<{ agents: Agent[] }>("/api/agents"),
      api<{ monitors: Monitor[] }>("/api/monitors"),
      api<AlertSettings>("/api/settings/alerts"),
      api<{ events: AlertEvent[] }>("/api/alerts/events")
    ]);

    setCurrentUser(sessionResponse.user);
    setAgents(agentResponse.agents);
    setMonitors(monitorResponse.monitors);
    setAlertSettings(settingsResponse);
    setAlertEvents(eventsResponse.events);
    setAuthenticated(true);
  };

  useEffect(() => {
    loadDashboard().catch(() => {
      setAuthenticated(false);
      setCurrentUser(null);
    });
    const timer = setInterval(() => loadDashboard().catch(() => undefined), 15_000);
    return () => clearInterval(timer);
  }, []);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
      });
      await loadDashboard();
      setActivePage("dashboard");
    } catch (error) {
      setLoginError(`Login failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setCurrentUser(null);
    setAgents([]);
    setMonitors([]);
    setAlertSettings(null);
    setAlertEvents([]);
    setActivePage("dashboard");
  };

  const createMonitor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMonitorError("");
    const payload = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, unknown>;
    const overrideSettings: Record<string, number> = {};
    if (payload.upDownWarningCycles) {
      overrideSettings.upDownWarningCycles = Number(payload.upDownWarningCycles);
    }
    if (payload.upDownDownCycles) {
      overrideSettings.upDownDownCycles = Number(payload.upDownDownCycles);
    }
    delete payload.upDownWarningCycles;
    delete payload.upDownDownCycles;
    if (Object.keys(overrideSettings).length > 0) {
      payload.overrideSettings = overrideSettings;
    }

    try {
      await api("/api/monitors", { method: "POST", body: JSON.stringify(payload) });
      event.currentTarget.reset();
      await loadDashboard();
    } catch (error) {
      setMonitorError(`Create failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const saveAlertSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAlertMessage("");
    try {
      await api("/api/settings/alerts", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
      });
      setAlertMessage("Alert settings saved.");
      await loadDashboard();
    } catch (error) {
      setAlertMessage(`Save failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const deleteMonitor = async (monitorId: string) => {
    if (!confirm("Delete this monitor?")) {
      return;
    }

    await api(`/api/monitors/${monitorId}`, { method: "DELETE" });
    await loadDashboard();
  };

  const approveHttpSignature = async (monitorId: string) => {
    await api(`/api/monitors/${monitorId}/approve-http-signature`, { method: "POST" });
    await loadDashboard();
  };

  if (!authenticated) {
    return (
      <>
        <Header
          authenticated={authenticated}
          activePage={activePage}
          currentUser={currentUser}
          onLogin={() => document.getElementById("login")?.scrollIntoView({ behavior: "smooth" })}
          onRefresh={() => loadDashboard().catch(() => undefined)}
        />
        <main>
          <section className="card" id="login">
            <h1>Sign in</h1>
            <p className="muted">
              Default username is <code>admin</code>. Use the configured admin password.
            </p>
            <form onSubmit={login}>
              <label>
                Username <input name="username" autoComplete="username" defaultValue="admin" />
              </label>
              <label>
                Password <input name="password" type="password" autoComplete="current-password" />
              </label>
              <button>Sign in</button>
            </form>
            <p className="muted">{loginError}</p>
          </section>
        </main>
      </>
    );
  }

  if (activePage === "settings") {
    return (
      <>
        <Header
          authenticated={authenticated}
          activePage={activePage}
          currentUser={currentUser}
          onDashboard={() => setActivePage("dashboard")}
          onLogout={() => logout().catch(() => undefined)}
          onRefresh={() => loadDashboard().catch(() => undefined)}
          onSettings={() => setActivePage("settings")}
        />
        <main>
          <div className="toolbar">
            <div>
              <h1>Settings</h1>
              <p className="muted">Manage alerting and notification behavior.</p>
            </div>
          </div>

          {alertSettings ? (
            <section className="card">
              <h2>Alert Settings</h2>
              <form onSubmit={saveAlertSettings}>
                <div className="grid">
                  <label>
                    Alert level
                    <select name="alertLevel" defaultValue={alertSettings.alertLevel}>
                      <option value="warning">Warning</option>
                      <option value="down">Down</option>
                    </select>
                  </label>
                  <label>
                    Repeat
                    <select name="repeat" defaultValue={alertSettings.repeat}>
                      <option value="none">None</option>
                      <option value="always">Always</option>
                      <option value="status_change_only">Status change only</option>
                    </select>
                  </label>
                  <label>
                    Check delay seconds <input name="delaySeconds" type="number" min="5" defaultValue={alertSettings.delaySeconds} />
                  </label>
                  <label>
                    Up/down warning cycles <input name="upDownWarningCycles" type="number" min="1" defaultValue={alertSettings.upDownWarningCycles} />
                  </label>
                  <label>
                    Up/down down cycles <input name="upDownDownCycles" type="number" min="1" defaultValue={alertSettings.upDownDownCycles} />
                  </label>
                  <label>
                    Webhook URL <input name="webhookUrl" placeholder="https://example.com/webhook" defaultValue={alertSettings.webhookUrl ?? ""} />
                  </label>
                </div>
                <button>Save alert settings</button>
              </form>
              <p className="muted">{alertMessage}</p>
            </section>
          ) : (
            <section className="card">
              <p className="muted">Loading settings...</p>
            </section>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <Header
        authenticated={authenticated}
        activePage={activePage}
        currentUser={currentUser}
        onDashboard={() => setActivePage("dashboard")}
        onLogout={() => logout().catch(() => undefined)}
        onRefresh={() => loadDashboard().catch(() => undefined)}
        onSettings={() => setActivePage("settings")}
      />
      <main>
        <div className="toolbar">
          <div>
            <h1>Dashboard</h1>
            <p className="muted">Agents, monitors, and the latest check history.</p>
          </div>
        </div>

        <section className="grid">
          {Object.entries(summary).map(([label, value]) => (
            <div className="card" key={label}>
              <div className="muted">{label}</div>
              <h2>{value}</h2>
            </div>
          ))}
        </section>

        <div className="grid top-gap">
          <section className="card">
            <h2>Create Monitor</h2>
            <form onSubmit={createMonitor}>
              <label>
                Friendly name <input name="friendlyName" required />
              </label>
              <label>
                Description <textarea name="description" rows={3} />
              </label>
              <label>
                Parent agent
                <select name="parentAgentId" required>
                  {agents.map((agent) => (
                    <option value={agent.id} key={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Parent monitor
                <select name="parentMonitorId">
                  <option value="">None</option>
                  {monitors.map((monitor) => (
                    <option value={monitor.id} key={monitor.id}>
                      {monitor.friendlyName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target <input name="target" placeholder="https://example.com or host:port" required />
              </label>
              <label>
                Type
                <select name="type">
                  <option value="up_down">Up / Down</option>
                  <option value="ssl">SSL Certificate</option>
                  <option value="http_https">HTTP/HTTPS Content</option>
                </select>
              </label>
              <label>
                Warning cycles override <input name="upDownWarningCycles" type="number" min="1" placeholder="Use global" />
              </label>
              <label>
                Down cycles override <input name="upDownDownCycles" type="number" min="1" placeholder="Use global" />
              </label>
              <button>Create monitor</button>
            </form>
            <p className="muted">{monitorError}</p>
          </section>

          <section className="card">
            <h2>Agents</h2>
            {agents.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Last Check-In</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id}>
                      <td>
                        <strong>{agent.name}</strong>
                        <br />
                        <span className="muted">{agent.id}</span>
                      </td>
                      <td>{agent.status}</td>
                      <td>{agent.lastCheckIn ?? "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No agents have registered yet.</p>
            )}
          </section>
        </div>

        <section className="card top-gap">
          <h2>Monitors</h2>
          {monitors.length ? (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Latest Check</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => {
                  const latest = monitor.checks[0];
                  return (
                    <tr key={monitor.id}>
                      <td>
                        <strong>{monitor.friendlyName}</strong>
                        <br />
                        <span className="muted">{monitor.description ?? ""}</span>
                        {monitor.parentMonitor ? (
                          <>
                            <br />
                            <span className="muted">Parent: {monitor.parentMonitor.friendlyName}</span>
                          </>
                        ) : null}
                        {monitor.proposedResponse && !monitor.expectedResponse ? (
                          <>
                            <br />
                            <button onClick={() => approveHttpSignature(monitor.id)}>Approve scanned content</button>
                          </>
                        ) : null}
                      </td>
                      <td>{statusPill(monitor.status)}</td>
                      <td>
                        {monitor.target}
                        <br />
                        <span className="muted">{monitor.type}</span>
                      </td>
                      <td>
                        {latest ? (
                          <>
                            {latest.message}
                            {latest.sslExpiresAt ? (
                              <>
                                <br />
                                <span className="muted">
                                  SSL expires: {latest.sslExpiresAt}
                                  {latest.sslSelfSigned ? " · self-signed" : ""}
                                </span>
                              </>
                            ) : null}
                            {latest.httpStatusCode ? (
                              <>
                                <br />
                                <span className="muted">
                                  HTTP {latest.httpStatusCode} ·{" "}
                                  {latest.httpMatched === null || latest.httpMatched === undefined
                                    ? "pending approval"
                                    : latest.httpMatched
                                      ? "matched"
                                      : "mismatch"}
                                </span>
                              </>
                            ) : null}
                            <br />
                            <span className="muted">{latest.checkedAt}</span>
                          </>
                        ) : (
                          "No checks yet"
                        )}
                      </td>
                      <td>
                        <button className="secondary" onClick={() => deleteMonitor(monitor.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">No monitors yet. Create one to start checks from an agent.</p>
          )}
        </section>

        <section className="card top-gap">
          <h2>Alert Events</h2>
          {alertEvents.length ? (
            <table>
              <thead>
                <tr>
                  <th>Monitor</th>
                  <th>Transition</th>
                  <th>Notification</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {alertEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{event.monitor.friendlyName}</td>
                    <td>
                      {statusPill(event.previousStatus)} -&gt; {statusPill(event.newStatus)}
                      {event.suppressedByMonitorId ? (
                        <>
                          <br />
                          <span className="muted">Suppressed by parent</span>
                        </>
                      ) : null}
                    </td>
                    <td>{event.notified ? "Sent" : event.notificationError ?? "Not sent"}</td>
                    <td>{event.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No alert events yet.</p>
          )}
        </section>
      </main>
    </>
  );
};

const Header = ({
  authenticated,
  activePage,
  currentUser,
  onDashboard,
  onLogin,
  onLogout,
  onRefresh,
  onSettings
}: {
  authenticated: boolean;
  activePage: AppPage;
  currentUser: AuthUser | null;
  onDashboard?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onRefresh: () => void;
  onSettings?: () => void;
}) => (
  <header>
    <div>
      <strong>NetworkUptime</strong> <span className="muted">server dashboard</span>
    </div>
    <div className="header-actions">
      <span className="muted">{currentUser ? `Logged in as ${currentUser.username}` : ""}</span>
      {authenticated ? (
        <button className="secondary" disabled={activePage === "dashboard"} onClick={onDashboard}>
          Dashboard
        </button>
      ) : null}
      {authenticated ? (
        <button className="secondary" disabled={activePage === "settings"} onClick={onSettings}>
          Settings
        </button>
      ) : null}
      <button className="secondary" onClick={authenticated ? onLogout : onLogin}>
        {authenticated ? "Logout" : "Login"}
      </button>
      <button className="secondary" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  </header>
);
