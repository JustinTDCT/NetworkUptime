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

type ServerSettings = {
  serverAddress: string;
  serverPort: number;
  ipListMode: "allow_all_blocklist" | "allow_none_whitelist";
  ipAllowlist: string[];
  ipBlocklist: string[];
  publicReadOnly: boolean;
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

const splitLines = (value: string) =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

export const App = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [alertSettings, setAlertSettings] = useState<AlertSettings | null>(null);
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [publicReadOnly, setPublicReadOnly] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [activePage, setActivePage] = useState<AppPage>("dashboard");
  const [loginError, setLoginError] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [serverMessage, setServerMessage] = useState("");

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
    const sessionResponse = await api<{ user: AuthUser | null; publicReadOnly: boolean }>("/api/auth/status");
    if (!sessionResponse.user && !sessionResponse.publicReadOnly) {
      throw new Error("Authentication required.");
    }

    const [agentResponse, monitorResponse, eventsResponse] = await Promise.all([
      api<{ agents: Agent[] }>("/api/agents"),
      api<{ monitors: Monitor[] }>("/api/monitors"),
      api<{ events: AlertEvent[] }>("/api/alerts/events")
    ]);
    const [alertSettingsResponse, serverSettingsResponse] = sessionResponse.user
      ? await Promise.all([api<AlertSettings>("/api/settings/alerts"), api<ServerSettings>("/api/settings/server")])
      : [null, null];

    setCurrentUser(sessionResponse.user);
    setAgents(agentResponse.agents);
    setMonitors(monitorResponse.monitors);
    setAlertSettings(alertSettingsResponse);
    setServerSettings(serverSettingsResponse);
    setAlertEvents(eventsResponse.events);
    setAuthenticated(Boolean(sessionResponse.user));
    setPublicReadOnly(sessionResponse.publicReadOnly);
  };

  useEffect(() => {
    loadDashboard().catch(() => {
      setAuthenticated(false);
      setPublicReadOnly(false);
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
    setPublicReadOnly(false);
    setCurrentUser(null);
    setAgents([]);
    setMonitors([]);
    setAlertSettings(null);
    setServerSettings(null);
    setAlertEvents([]);
    setActivePage("dashboard");
    await loadDashboard().catch(() => undefined);
  };

  const createMonitor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMonitorError("");
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form)) as Record<string, unknown>;
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
      form.reset();
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

  const saveServerSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerMessage("");
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form)) as Record<string, FormDataEntryValue>;
    const agentKey = String(payload.agentKey ?? "").trim();

    try {
      await api("/api/settings/server", {
        method: "PUT",
        body: JSON.stringify({
          serverAddress: String(payload.serverAddress ?? ""),
          serverPort: Number(payload.serverPort),
          agentKey,
          ipListMode: String(payload.ipListMode ?? "allow_all_blocklist"),
          ipAllowlist: splitLines(String(payload.ipAllowlist ?? "")),
          ipBlocklist: splitLines(String(payload.ipBlocklist ?? "")),
          publicReadOnly: payload.publicReadOnly === "on"
        })
      });
      form.reset();
      setServerMessage("Server settings saved. Restart the server if you changed the listening port.");
      await loadDashboard();
    } catch (error) {
      setServerMessage(`Save failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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

  if (!authenticated && !publicReadOnly) {
    return (
      <>
        <Header
          authenticated={authenticated}
          activePage={activePage}
          currentUser={currentUser}
          onLogin={() => document.getElementById("login")?.scrollIntoView({ behavior: "smooth" })}
          onRefresh={() => loadDashboard().catch(() => undefined)}
          publicReadOnly={publicReadOnly}
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

  if (activePage === "settings" && authenticated) {
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
          publicReadOnly={publicReadOnly}
        />
        <main>
          <div className="toolbar">
            <div>
              <h1>Settings</h1>
              <p className="muted">Manage server deployment, agent access, and alerting behavior.</p>
            </div>
          </div>

          {serverSettings ? (
            <section className="card">
              <h2>Server Settings</h2>
              <p className="muted">
                These values are used by agents to connect back to this server. The agent key is write-only; enter a new UUID only when rotating it.
              </p>
              <form onSubmit={saveServerSettings}>
                <div className="grid">
                  <label>
                    Server address
                    <input name="serverAddress" type="url" defaultValue={serverSettings.serverAddress} placeholder="https://example.com:8443" required />
                  </label>
                  <label>
                    Server port
                    <input name="serverPort" type="number" min="1" max="65535" defaultValue={serverSettings.serverPort} required />
                  </label>
                  <label>
                    Agent key
                    <input name="agentKey" placeholder="Leave blank to keep current key" />
                  </label>
                  <label>
                    IP whitelist mode
                    <select name="ipListMode" defaultValue={serverSettings.ipListMode}>
                      <option value="allow_all_blocklist">Allow all except blocked IPs</option>
                      <option value="allow_none_whitelist">Allow only whitelisted IPs</option>
                    </select>
                  </label>
                  <label>
                    IP allowlist
                    <textarea name="ipAllowlist" rows={4} defaultValue={serverSettings.ipAllowlist.join("\n")} placeholder="One IP per line" />
                  </label>
                  <label>
                    IP blocklist
                    <textarea name="ipBlocklist" rows={4} defaultValue={serverSettings.ipBlocklist.join("\n")} placeholder="One IP per line" />
                  </label>
                  <label className="checkbox-label">
                    <input name="publicReadOnly" type="checkbox" defaultChecked={serverSettings.publicReadOnly} />
                    Public read-only dashboard
                  </label>
                </div>
                <button>Save server settings</button>
              </form>
              <p className="muted">{serverMessage}</p>
            </section>
          ) : (
            <section className="card">
              <p className="muted">Loading server settings...</p>
            </section>
          )}

          {alertSettings ? (
            <section className="card top-gap">
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
        publicReadOnly={publicReadOnly}
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
          {authenticated ? (
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
          ) : null}

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
                        {authenticated && monitor.proposedResponse && !monitor.expectedResponse ? (
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
                        {authenticated ? (
                          <button className="secondary" onClick={() => deleteMonitor(monitor.id)}>
                            Delete
                          </button>
                        ) : null}
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
  onSettings,
  publicReadOnly
}: {
  authenticated: boolean;
  activePage: AppPage;
  currentUser: AuthUser | null;
  onDashboard?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onRefresh: () => void;
  onSettings?: () => void;
  publicReadOnly: boolean;
}) => (
  <header>
    <div>
      <strong>NetworkUptime</strong> <span className="muted">server dashboard</span>
    </div>
    <div className="header-actions">
      <span className="muted">
        {currentUser ? `Logged in as ${currentUser.username}` : publicReadOnly ? "Public read-only" : ""}
      </span>
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
