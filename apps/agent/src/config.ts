import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentConfigSchema } from "@networkuptime/shared";
import { z } from "zod";

const agentConfigFileSchema = z
  .object({
    name: z.string().optional(),
    id: z.string().uuid().optional(),
    description: z.string().optional(),
    serverUrl: z.string().url().optional(),
    serverKey: z.string().uuid().optional(),
    allowInsecureLocalhost: z.coerce.boolean().optional()
  })
  .default({});

export type AgentRuntimeConfig = z.infer<typeof agentConfigSchema> & {
  statePath: string;
  checkInIntervalSeconds: number;
};

const readJsonFile = async <T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> => {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const ensureAgentId = async (statePath: string, configuredId?: string): Promise<string> => {
  if (configuredId) {
    return configuredId;
  }

  const existing = await readJsonFile(statePath, z.object({ id: z.string().uuid() }));
  if (existing?.id) {
    return existing.id;
  }

  const id = randomUUID();
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ id }, null, 2));
  return id;
};

export const loadAgentConfig = async (): Promise<AgentRuntimeConfig> => {
  const configPath = process.env.NETWORKUPTIME_AGENT_CONFIG;
  const fileConfig = configPath ? await readJsonFile(configPath, agentConfigFileSchema) : undefined;
  const statePath = process.env.AGENT_STATE_PATH ?? "/data/agent-state.json";
  const id = await ensureAgentId(statePath, process.env.AGENT_ID ?? fileConfig?.id);

  const config = agentConfigSchema.parse({
    name: process.env.AGENT_NAME ?? fileConfig?.name ?? "NetworkUptime Agent",
    id,
    description: process.env.AGENT_DESCRIPTION ?? fileConfig?.description ?? "",
    serverUrl: process.env.SERVER_URL ?? fileConfig?.serverUrl,
    serverKey: process.env.SERVER_KEY ?? fileConfig?.serverKey,
    allowInsecureLocalhost:
      process.env.ALLOW_INSECURE_LOCALHOST ?? fileConfig?.allowInsecureLocalhost ?? false
  });

  return {
    ...config,
    statePath,
    checkInIntervalSeconds: Number(process.env.AGENT_CHECK_IN_INTERVAL_SECONDS ?? 60)
  };
};
