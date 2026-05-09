export const renderAppShell = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NetworkUptime</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top left, #1e3a8a 0, transparent 32rem), #0f172a;
      }

      header {
        align-items: center;
        border-bottom: 1px solid #1e293b;
        display: flex;
        justify-content: space-between;
        padding: 1rem 1.5rem;
      }

      main {
        margin: 0 auto;
        max-width: 1180px;
        padding: 1.5rem;
      }

      input, select, textarea, button {
        border-radius: 0.7rem;
        border: 1px solid #334155;
        box-sizing: border-box;
        font: inherit;
        padding: 0.7rem 0.8rem;
      }

      input, select, textarea {
        background: #020617;
        color: #e2e8f0;
        width: 100%;
      }

      button {
        background: #2563eb;
        border-color: #2563eb;
        color: white;
        cursor: pointer;
        font-weight: 700;
      }

      button.secondary {
        background: #1e293b;
        border-color: #334155;
      }

      .grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      }

      .card {
        background: rgba(15, 23, 42, 0.82);
        border: 1px solid #1e293b;
        border-radius: 1rem;
        padding: 1rem;
      }

      .muted {
        color: #94a3b8;
      }

      .pill {
        border-radius: 999px;
        display: inline-block;
        font-size: 0.8rem;
        font-weight: 700;
        padding: 0.25rem 0.6rem;
        text-transform: uppercase;
      }

      .up { background: #14532d; color: #bbf7d0; }
      .down { background: #7f1d1d; color: #fecaca; }
      .warning { background: #713f12; color: #fde68a; }
      .suppressed { background: #312e81; color: #c4b5fd; }
      .unknown { background: #334155; color: #cbd5e1; }

      table {
        border-collapse: collapse;
        width: 100%;
      }

      th, td {
        border-bottom: 1px solid #1e293b;
        padding: 0.7rem;
        text-align: left;
        vertical-align: top;
      }

      form {
        display: grid;
        gap: 0.8rem;
      }

      .toolbar {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
        margin-bottom: 1rem;
      }

      .hidden {
        display: none;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <strong>NetworkUptime</strong>
        <span class="muted">server dashboard</span>
      </div>
      <button class="secondary" id="refreshButton">Refresh</button>
    </header>
    <main>
      <section id="loginCard" class="card">
        <h1>Sign in</h1>
        <p class="muted">Default username is <code>admin</code>. The default password is <code>admin</code> unless configured.</p>
        <form id="loginForm">
          <label>Username <input name="username" autocomplete="username" value="admin" /></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" /></label>
          <button>Sign in</button>
        </form>
        <p id="loginError" class="muted"></p>
      </section>

      <section id="dashboard" class="hidden">
        <div class="toolbar">
          <div>
            <h1>Dashboard</h1>
            <p class="muted">Agents, monitors, and the latest check history.</p>
          </div>
        </div>
        <div class="grid" id="summary"></div>

        <div class="grid" style="margin-top: 1rem;">
          <section class="card">
            <h2>Create Monitor</h2>
            <form id="monitorForm">
              <label>Friendly name <input name="friendlyName" required /></label>
              <label>Description <textarea name="description" rows="3"></textarea></label>
              <label>Parent agent <select name="parentAgentId" required></select></label>
              <label>Parent monitor <select name="parentMonitorId"></select></label>
              <label>Target <input name="target" placeholder="https://example.com or host:port" required /></label>
              <label>Type
                <select name="type">
                  <option value="up_down">Up / Down</option>
                  <option value="ssl">SSL Certificate</option>
                </select>
              </label>
              <label>Warning cycles override <input name="upDownWarningCycles" type="number" min="1" placeholder="Use global" /></label>
              <label>Down cycles override <input name="upDownDownCycles" type="number" min="1" placeholder="Use global" /></label>
              <button>Create monitor</button>
            </form>
            <p id="monitorError" class="muted"></p>
          </section>

          <section class="card">
            <h2>Agents</h2>
            <div id="agents"></div>
          </section>
        </div>

        <section class="card" style="margin-top: 1rem;">
          <h2>Alert Settings</h2>
          <form id="alertSettingsForm">
            <div class="grid">
              <label>Alert level
                <select name="alertLevel">
                  <option value="warning">Warning</option>
                  <option value="down">Down</option>
                </select>
              </label>
              <label>Repeat
                <select name="repeat">
                  <option value="none">None</option>
                  <option value="always">Always</option>
                  <option value="status_change_only">Status change only</option>
                </select>
              </label>
              <label>Check delay seconds <input name="delaySeconds" type="number" min="5" /></label>
              <label>Up/down warning cycles <input name="upDownWarningCycles" type="number" min="1" /></label>
              <label>Up/down down cycles <input name="upDownDownCycles" type="number" min="1" /></label>
              <label>Webhook URL <input name="webhookUrl" placeholder="https://example.com/webhook" /></label>
            </div>
            <button>Save alert settings</button>
          </form>
          <p id="alertSettingsMessage" class="muted"></p>
        </section>

        <section class="card" style="margin-top: 1rem;">
          <h2>Monitors</h2>
          <div id="monitors"></div>
        </section>

        <section class="card" style="margin-top: 1rem;">
          <h2>Alert Events</h2>
          <div id="alertEvents"></div>
        </section>
      </section>
    </main>

    <script>
      const state = { agents: [], monitors: [], alertSettings: null, alertEvents: [] };

      const api = async (path, options = {}) => {
        const response = await fetch(path, {
          credentials: "include",
          headers: { "content-type": "application/json", ...(options.headers || {}) },
          ...options
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        return response.json();
      };

      const statusPill = (status) => '<span class="pill ' + String(status).toLowerCase() + '">' + status + '</span>';

      const loadDashboard = async () => {
        const [agents, monitors, alertSettings, alertEvents] = await Promise.all([
          api("/api/agents"),
          api("/api/monitors"),
          api("/api/settings/alerts"),
          api("/api/alerts/events")
        ]);

        state.agents = agents.agents;
        state.monitors = monitors.monitors;
        state.alertSettings = alertSettings;
        state.alertEvents = alertEvents.events;
        document.getElementById("loginCard").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        render();
      };

      const render = () => {
        const up = state.monitors.filter((monitor) => monitor.status === "UP").length;
        const down = state.monitors.filter((monitor) => monitor.status === "DOWN").length;
        const unknown = state.monitors.filter((monitor) => monitor.status === "UNKNOWN").length;
        document.getElementById("summary").innerHTML = [
          ["Agents", state.agents.length],
          ["Monitors", state.monitors.length],
          ["Up", up],
          ["Down", down],
          ["Unknown", unknown]
        ].map(([label, value]) => '<div class="card"><div class="muted">' + label + '</div><h2>' + value + '</h2></div>').join("");

        const agentOptions = state.agents.map((agent) => '<option value="' + agent.id + '">' + agent.name + '</option>').join("");
        document.querySelector('[name="parentAgentId"]').innerHTML = agentOptions;
        document.querySelector('[name="parentMonitorId"]').innerHTML =
          '<option value="">None</option>' +
          state.monitors.map((monitor) => '<option value="' + monitor.id + '">' + monitor.friendlyName + '</option>').join("");

        if (state.alertSettings) {
          const form = document.getElementById("alertSettingsForm");
          for (const [key, value] of Object.entries(state.alertSettings)) {
            if (form.elements[key]) form.elements[key].value = value ?? "";
          }
        }

        document.getElementById("agents").innerHTML = state.agents.length
          ? '<table><thead><tr><th>Name</th><th>Status</th><th>Last Check-In</th></tr></thead><tbody>' +
            state.agents.map((agent) =>
              '<tr><td><strong>' + agent.name + '</strong><br><span class="muted">' + agent.id + '</span></td><td>' + agent.status + '</td><td>' + (agent.lastCheckIn || "never") + '</td></tr>'
            ).join("") +
            '</tbody></table>'
          : '<p class="muted">No agents have registered yet.</p>';

        document.getElementById("monitors").innerHTML = state.monitors.length
          ? '<table><thead><tr><th>Name</th><th>Status</th><th>Target</th><th>Latest Check</th><th></th></tr></thead><tbody>' +
            state.monitors.map((monitor) => {
              const latest = monitor.checks[0];
              const parent = monitor.parentMonitor ? '<br><span class="muted">Parent: ' + monitor.parentMonitor.friendlyName + '</span>' : '';
              const sslDetails = latest && latest.sslExpiresAt
                ? '<br><span class="muted">SSL expires: ' + latest.sslExpiresAt + (latest.sslSelfSigned ? ' · self-signed' : '') + '</span>'
                : '';
              return '<tr><td><strong>' + monitor.friendlyName + '</strong><br><span class="muted">' + (monitor.description || "") + '</span>' + parent + '</td><td>' + statusPill(monitor.status) + '</td><td>' + monitor.target + '<br><span class="muted">' + monitor.type + '</span></td><td>' + (latest ? latest.message + sslDetails + '<br><span class="muted">' + latest.checkedAt + '</span>' : 'No checks yet') + '</td><td><button class="secondary" data-delete="' + monitor.id + '">Delete</button></td></tr>';
            }).join("") +
            '</tbody></table>'
          : '<p class="muted">No monitors yet. Create one to start checks from an agent.</p>';

        document.getElementById("alertEvents").innerHTML = state.alertEvents.length
          ? '<table><thead><tr><th>Monitor</th><th>Transition</th><th>Notification</th><th>Time</th></tr></thead><tbody>' +
            state.alertEvents.map((event) =>
              '<tr><td>' + event.monitor.friendlyName + '</td><td>' + statusPill(event.previousStatus) + ' -> ' + statusPill(event.newStatus) + (event.suppressedByMonitorId ? '<br><span class="muted">Suppressed by parent</span>' : '') + '</td><td>' + (event.notified ? 'Sent' : (event.notificationError || 'Not sent')) + '</td><td>' + event.createdAt + '</td></tr>'
            ).join("") +
            '</tbody></table>'
          : '<p class="muted">No alert events yet.</p>';
      };

      document.getElementById("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(form))
          });
          await loadDashboard();
        } catch (error) {
          document.getElementById("loginError").textContent = "Login failed: " + error.message;
        }
      });

      document.getElementById("monitorForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payload = Object.fromEntries(form);
        const overrideSettings = {};
        if (payload.upDownWarningCycles) overrideSettings.upDownWarningCycles = Number(payload.upDownWarningCycles);
        if (payload.upDownDownCycles) overrideSettings.upDownDownCycles = Number(payload.upDownDownCycles);
        delete payload.upDownWarningCycles;
        delete payload.upDownDownCycles;
        if (Object.keys(overrideSettings).length > 0) payload.overrideSettings = overrideSettings;
        try {
          await api("/api/monitors", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          event.currentTarget.reset();
          await loadDashboard();
        } catch (error) {
          document.getElementById("monitorError").textContent = "Create failed: " + error.message;
        }
      });

      document.getElementById("alertSettingsForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(event.currentTarget));
        try {
          await api("/api/settings/alerts", {
            method: "PUT",
            body: JSON.stringify(payload)
          });
          document.getElementById("alertSettingsMessage").textContent = "Alert settings saved.";
          await loadDashboard();
        } catch (error) {
          document.getElementById("alertSettingsMessage").textContent = "Save failed: " + error.message;
        }
      });

      document.getElementById("monitors").addEventListener("click", async (event) => {
        const id = event.target.dataset.delete;
        if (!id || !confirm("Delete this monitor?")) return;
        await api("/api/monitors/" + id, { method: "DELETE" });
        await loadDashboard();
      });

      document.getElementById("refreshButton").addEventListener("click", () => loadDashboard().catch(() => {}));

      loadDashboard().catch(() => {
        document.getElementById("loginCard").classList.remove("hidden");
      });
      setInterval(() => loadDashboard().catch(() => {}), 15000);
    </script>
  </body>
</html>`;
