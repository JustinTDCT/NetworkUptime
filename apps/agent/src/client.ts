import { type AgentRuntimeConfig } from "./config.js";

export type AssignedMonitor = {
  id: string;
  friendlyName: string;
  target: string;
  type: "up_down";
};

export type MonitorCheckResult = {
  monitorId: string;
  status: "up" | "warning" | "down";
  latencyMs?: number;
  message?: string;
  rawDetails?: Record<string, unknown>;
};

const apiUrl = (config: AgentRuntimeConfig, path: string): string => {
  return new URL(path, config.serverUrl).toString();
};

const authHeaders = (config: AgentRuntimeConfig): Record<string, string> => ({
  authorization: `Bearer ${config.serverKey}`,
  "content-type": "application/json"
});

const getJson = async <TResponse>(config: AgentRuntimeConfig, path: string): Promise<TResponse> => {
  const response = await fetch(apiUrl(config, path), {
    headers: authHeaders(config)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server returned ${response.status}: ${text}`);
  }

  return response.json() as Promise<TResponse>;
};

const postJson = async <TBody>(config: AgentRuntimeConfig, path: string, body: TBody): Promise<void> => {
  const response = await fetch(apiUrl(config, path), {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server returned ${response.status}: ${text}`);
  }
};

export const registerAgent = async (config: AgentRuntimeConfig): Promise<void> => {
  await postJson(config, "/api/agents/register", {
    id: config.id,
    name: config.name,
    description: config.description,
    version: "0.1.0"
  });
};

export const checkInAgent = async (config: AgentRuntimeConfig): Promise<void> => {
  await postJson(config, `/api/agents/${config.id}/check-in`, {
    version: "0.1.0",
    observedAt: new Date().toISOString()
  });
};

export const fetchAssignedMonitors = async (
  config: AgentRuntimeConfig
): Promise<AssignedMonitor[]> => {
  const response = await getJson<{ monitors: AssignedMonitor[] }>(
    config,
    `/api/agents/${config.id}/monitors`
  );
  return response.monitors;
};

export const submitMonitorCheck = async (
  config: AgentRuntimeConfig,
  result: MonitorCheckResult
): Promise<void> => {
  await postJson(config, `/api/agents/${config.id}/checks`, result);
};
