import { type AgentRuntimeConfig } from "./config.js";

const apiUrl = (config: AgentRuntimeConfig, path: string): string => {
  return new URL(path, config.serverUrl).toString();
};

const postJson = async <TBody>(config: AgentRuntimeConfig, path: string, body: TBody): Promise<void> => {
  const response = await fetch(apiUrl(config, path), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.serverKey}`,
      "content-type": "application/json"
    },
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
