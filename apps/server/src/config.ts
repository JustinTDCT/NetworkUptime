import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { alertSettingsSchema, serverSettingsSchema } from "@networkuptime/shared";

const serverConfigFileSchema = z
  .object({
    server: serverSettingsSchema.partial().optional(),
    alerts: alertSettingsSchema.partial().optional()
  })
  .default({});

export type ServerRuntimeConfig = {
  host: string;
  port: number;
  jwtSecret: string;
  adminUsername: string;
  adminPassword: string;
  databaseUrl: string;
  tls?: {
    cert: string;
    key: string;
  };
  settings: {
    serverAddress: string;
    serverPort: number;
    agentKey: string;
    ipListMode: "allow_all_blocklist" | "allow_none_whitelist";
    ipAllowlist: string[];
    ipBlocklist: string[];
    publicReadOnly: boolean;
  };
  alerts: z.infer<typeof alertSettingsSchema>;
};

const readConfigFile = async (): Promise<z.infer<typeof serverConfigFileSchema>> => {
  const path = process.env.NETWORKUPTIME_CONFIG;
  if (!path) {
    return {};
  }

  const raw = await readFile(path, "utf8");
  return serverConfigFileSchema.parse(JSON.parse(raw));
};

export const loadConfig = async (): Promise<ServerRuntimeConfig> => {
  const fileConfig = await readConfigFile();
  const serverPort = Number(process.env.SERVER_PORT ?? fileConfig.server?.serverPort ?? 8443);
  const agentKey = process.env.SERVER_AGENT_KEY ?? fileConfig.server?.agentKey ?? randomUUID();
  const tlsCertFile = process.env.TLS_CERT_FILE;
  const tlsKeyFile = process.env.TLS_KEY_FILE;

  const settings = serverSettingsSchema.parse({
    serverAddress:
      process.env.SERVER_ADDRESS ??
      fileConfig.server?.serverAddress ??
      `https://localhost:${serverPort}`,
    serverPort,
    agentKey,
    ipListMode: process.env.IP_LIST_MODE ?? fileConfig.server?.ipListMode,
    ipAllowlist: process.env.IP_ALLOWLIST?.split(",").filter(Boolean) ?? fileConfig.server?.ipAllowlist,
    ipBlocklist: process.env.IP_BLOCKLIST?.split(",").filter(Boolean) ?? fileConfig.server?.ipBlocklist,
    publicReadOnly: process.env.PUBLIC_READ_ONLY ?? fileConfig.server?.publicReadOnly
  });

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: settings.serverPort,
    jwtSecret: process.env.JWT_SECRET ?? randomUUID(),
    adminUsername: process.env.ADMIN_USERNAME ?? "admin",
    adminPassword: process.env.ADMIN_PASSWORD ?? "admin",
    databaseUrl: process.env.DATABASE_URL ?? "file:./networkuptime.db",
    tls:
      tlsCertFile && tlsKeyFile
        ? {
            cert: await readFile(tlsCertFile, "utf8"),
            key: await readFile(tlsKeyFile, "utf8")
          }
        : undefined,
    settings,
    alerts: alertSettingsSchema.parse({
      ...fileConfig.alerts,
      alertLevel: process.env.ALERT_LEVEL ?? fileConfig.alerts?.alertLevel,
      repeat: process.env.ALERT_REPEAT ?? fileConfig.alerts?.repeat,
      delaySeconds: process.env.ALERT_DELAY_SECONDS ?? fileConfig.alerts?.delaySeconds,
      webhookUrl: process.env.ALERT_WEBHOOK_URL ?? fileConfig.alerts?.webhookUrl
    })
  };
};
