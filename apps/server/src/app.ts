import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import staticPlugin from "@fastify/static";
import { AlertLevel, AlertRepeat, MonitorStatus, MonitorType, prisma } from "@networkuptime/db";
import {
  agentCheckInSchema,
  alertSettingsSchema,
  bearerToken,
  loginSchema,
  monitorCheckResultSchema,
  monitorSchema,
  registerAgentSchema,
  serverSettingsSchema
} from "@networkuptime/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type ServerRuntimeConfig } from "./config.js";
import { hashSecret, verifySecret } from "./security.js";
import { renderAppShell } from "./ui.js";

const ipModeToDb = (mode: "allow_all_blocklist" | "allow_none_whitelist") =>
  mode === "allow_all_blocklist" ? "ALLOW_ALL_BLOCKLIST" : "ALLOW_NONE_WHITELIST";

const ipModeFromDb = (mode: string) =>
  mode === "ALLOW_NONE_WHITELIST" ? "allow_none_whitelist" : "allow_all_blocklist";

const monitorTypeToDb = (type: "ssl" | "up_down" | "http_https") => {
  if (type === "ssl") {
    return MonitorType.SSL;
  }

  if (type === "http_https") {
    return MonitorType.HTTP_HTTPS;
  }

  return MonitorType.UP_DOWN;
};

const monitorStatusToDb = (status: "up" | "warning" | "down") => {
  if (status === "up") {
    return MonitorStatus.UP;
  }

  if (status === "warning") {
    return MonitorStatus.WARNING;
  }

  return MonitorStatus.DOWN;
};

type EffectiveAlertSettings = z.infer<typeof alertSettingsSchema>;

const alertLevelToDb = (level: "warning" | "down") =>
  level === "warning" ? AlertLevel.WARNING : AlertLevel.DOWN;

const alertRepeatToDb = (repeat: "none" | "always" | "status_change_only") => {
  if (repeat === "none") {
    return AlertRepeat.NONE;
  }

  if (repeat === "always") {
    return AlertRepeat.ALWAYS;
  }

  return AlertRepeat.STATUS_CHANGE_ONLY;
};

const alertSettingsToDb = (settings: EffectiveAlertSettings) => ({
  alertLevel: alertLevelToDb(settings.alertLevel),
  repeat: alertRepeatToDb(settings.repeat),
  delaySeconds: settings.delaySeconds,
  upDownWarningCycles: settings.upDownWarningCycles,
  upDownDownCycles: settings.upDownDownCycles,
  latencyCycles: settings.latencyCycles,
  latencyWarningMs: settings.latencyWarningMs,
  latencyDownMs: settings.latencyDownMs,
  sslWarningDays: settings.sslWarningDays,
  sslDownDays: settings.sslDownDays,
  httpCycles: settings.httpCycles,
  webhookUrl: settings.webhookUrl
});

const alertLevelFromDb = (level: AlertLevel) => (level === AlertLevel.WARNING ? "warning" : "down");

const alertRepeatFromDb = (repeat: AlertRepeat) => {
  if (repeat === AlertRepeat.NONE) {
    return "none";
  }

  if (repeat === AlertRepeat.ALWAYS) {
    return "always";
  }

  return "status_change_only";
};

const alertSettingsFromDb = (settings: {
  alertLevel: AlertLevel;
  repeat: AlertRepeat;
  delaySeconds: number;
  upDownWarningCycles: number;
  upDownDownCycles: number;
  latencyCycles: number;
  latencyWarningMs: number;
  latencyDownMs: number;
  sslWarningDays: number;
  sslDownDays: number;
  httpCycles: number;
  webhookUrl: string | null;
}): EffectiveAlertSettings => ({
  alertLevel: alertLevelFromDb(settings.alertLevel),
  repeat: alertRepeatFromDb(settings.repeat),
  delaySeconds: settings.delaySeconds,
  upDownWarningCycles: settings.upDownWarningCycles,
  upDownDownCycles: settings.upDownDownCycles,
  latencyCycles: settings.latencyCycles,
  latencyWarningMs: settings.latencyWarningMs,
  latencyDownMs: settings.latencyDownMs,
  sslWarningDays: settings.sslWarningDays,
  sslDownDays: settings.sslDownDays,
  httpCycles: settings.httpCycles,
  webhookUrl: settings.webhookUrl ?? undefined
});

const parseJsonList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const serverSettingsUpdateSchema = serverSettingsSchema.extend({
  agentKey: z.union([z.string().uuid(), z.literal("")]).optional()
});

const webDistDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const webIndexPath = path.join(webDistDirectory, "index.html");

const parseJsonRecord = (value: string | null | undefined): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const mergeMonitorAlertSettings = (
  globalSettings: EffectiveAlertSettings,
  overrideSettings: string | null
): EffectiveAlertSettings => {
  if (!overrideSettings) {
    return globalSettings;
  }

  try {
    return alertSettingsSchema.parse({
      ...globalSettings,
      ...JSON.parse(overrideSettings)
    });
  } catch {
    return globalSettings;
  }
};

const isAlertStatus = (status: MonitorStatus, level: AlertLevel): boolean => {
  if (status === MonitorStatus.DOWN) {
    return true;
  }

  return level === AlertLevel.WARNING && status === MonitorStatus.WARNING;
};

const calculateUpDownStatus = async (
  monitorId: string,
  settings: EffectiveAlertSettings
): Promise<MonitorStatus> => {
  const checks = await prisma.monitorCheck.findMany({
    where: { monitorId },
    orderBy: { checkedAt: "desc" },
    take: Math.max(settings.upDownDownCycles, settings.upDownWarningCycles)
  });

  if (checks[0]?.status === MonitorStatus.UP) {
    return MonitorStatus.UP;
  }

  const consecutiveFailures = checks.findIndex((check) => check.status === MonitorStatus.UP);
  const failureCount = consecutiveFailures === -1 ? checks.length : consecutiveFailures;

  if (failureCount >= settings.upDownDownCycles) {
    return MonitorStatus.DOWN;
  }

  if (failureCount >= settings.upDownWarningCycles) {
    return MonitorStatus.WARNING;
  }

  return checks.length > 0 ? MonitorStatus.UP : MonitorStatus.UNKNOWN;
};

const calculateSslStatus = async (
  monitorId: string,
  settings: EffectiveAlertSettings
): Promise<MonitorStatus> => {
  const check = await prisma.monitorCheck.findFirst({
    where: { monitorId },
    orderBy: { checkedAt: "desc" }
  });

  if (!check) {
    return MonitorStatus.UNKNOWN;
  }

  if (!check.sslValid || !check.sslExpiresAt) {
    return MonitorStatus.DOWN;
  }

  const daysRemaining = Math.ceil(
    (check.sslExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  if (daysRemaining <= settings.sslDownDays) {
    return MonitorStatus.DOWN;
  }

  if (daysRemaining <= settings.sslWarningDays) {
    return MonitorStatus.WARNING;
  }

  return MonitorStatus.UP;
};

const calculateHttpStatus = async (
  monitorId: string,
  settings: EffectiveAlertSettings
): Promise<MonitorStatus> => {
  const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: monitorId } });
  const expected = parseJsonRecord(monitor.expectedResponse);
  if (!expected) {
    return MonitorStatus.UNKNOWN;
  }

  const checks = await prisma.monitorCheck.findMany({
    where: { monitorId },
    orderBy: { checkedAt: "desc" },
    take: settings.httpCycles
  });

  if (checks[0]?.httpMatched) {
    return MonitorStatus.UP;
  }

  const consecutiveMismatches = checks.findIndex((check) => check.httpMatched);
  const mismatchCount = consecutiveMismatches === -1 ? checks.length : consecutiveMismatches;

  if (mismatchCount >= settings.httpCycles) {
    return MonitorStatus.DOWN;
  }

  return checks.length > 0 ? MonitorStatus.WARNING : MonitorStatus.UNKNOWN;
};

const httpSignaturesMatch = (
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | undefined
): boolean => {
  if (!actual) {
    return false;
  }

  return (
    expected.statusCode === actual.statusCode &&
    expected.title === actual.title &&
    expected.bodyHash === actual.bodyHash
  );
};

const sendWebhookNotification = async (
  webhookUrl: string | undefined,
  payload: Record<string, unknown>
): Promise<string | undefined> => {
  if (!webhookUrl) {
    return undefined;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return `Webhook returned ${response.status}: ${await response.text()}`;
  }

  return undefined;
};

const evaluateMonitorState = async (
  monitorId: string,
  message?: string
): Promise<MonitorStatus> => {
  const [monitor, globalAlertSettings] = await Promise.all([
    prisma.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      include: { parentMonitor: true }
    }),
    prisma.alertSettings.findUniqueOrThrow({ where: { id: "global" } })
  ]);
  const settings = mergeMonitorAlertSettings(
    alertSettingsFromDb(globalAlertSettings),
    monitor.overrideSettings
  );
  const previousStatus = monitor.status;
  const calculatedStatus = await (async () => {
    if (monitor.type === MonitorType.UP_DOWN) {
      return calculateUpDownStatus(monitor.id, settings);
    }

    if (monitor.type === MonitorType.SSL) {
      return calculateSslStatus(monitor.id, settings);
    }

    if (monitor.type === MonitorType.HTTP_HTTPS) {
      return calculateHttpStatus(monitor.id, settings);
    }

    return monitor.status;
  })();
  const suppressedByMonitorId =
    monitor.parentMonitor &&
    (monitor.parentMonitor.status === MonitorStatus.WARNING ||
      monitor.parentMonitor.status === MonitorStatus.DOWN ||
      monitor.parentMonitor.status === MonitorStatus.SUPPRESSED)
      ? monitor.parentMonitor.id
      : undefined;
  const newStatus = suppressedByMonitorId ? MonitorStatus.SUPPRESSED : calculatedStatus;

  await prisma.monitor.update({
    where: { id: monitor.id },
    data: { status: newStatus }
  });

  const statusChanged = previousStatus !== newStatus;
  const meetsAlertLevel = isAlertStatus(newStatus, globalAlertSettings.alertLevel);
  const recovered = previousStatus !== MonitorStatus.UP && newStatus === MonitorStatus.UP;
  const shouldNotify =
    globalAlertSettings.repeat === AlertRepeat.ALWAYS
      ? meetsAlertLevel
      : globalAlertSettings.repeat === AlertRepeat.STATUS_CHANGE_ONLY
        ? statusChanged && (meetsAlertLevel || recovered)
        : statusChanged && meetsAlertLevel && !isAlertStatus(previousStatus, globalAlertSettings.alertLevel);

  if (statusChanged || shouldNotify) {
    const event = await prisma.alertEvent.create({
      data: {
        monitorId: monitor.id,
        previousStatus,
        newStatus,
        message,
        suppressedByMonitorId,
        notified: false
      }
    });

    if (shouldNotify && globalAlertSettings.webhookUrl) {
      const notificationError = await sendWebhookNotification(globalAlertSettings.webhookUrl, {
        eventId: event.id,
        monitorId: monitor.id,
        monitorName: monitor.friendlyName,
        target: monitor.target,
        previousStatus,
        newStatus,
        message,
        suppressedByMonitorId,
        createdAt: event.createdAt
      });

      await prisma.alertEvent.update({
        where: { id: event.id },
        data: {
          notified: !notificationError,
          notificationError
        }
      });
    }
  }

  return newStatus;
};

const clientIp = (request: FastifyRequest): string => {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]?.trim() ?? request.ip;
  }

  return request.ip;
};

const enforceIpRules = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  if (!request.url.startsWith("/api/agents")) {
    return;
  }

  const settings = await prisma.serverSettings.findUnique({ where: { id: "default" } });
  if (!settings) {
    return;
  }

  const ip = clientIp(request);
  const allowlist = parseJsonList(settings.ipAllowlist);
  const blocklist = parseJsonList(settings.ipBlocklist);

  if (settings.ipListMode === "ALLOW_ALL_BLOCKLIST" && blocklist.includes(ip)) {
    await reply.code(403).send({ error: "IP is blocked." });
  }

  if (settings.ipListMode === "ALLOW_NONE_WHITELIST" && !allowlist.includes(ip)) {
    await reply.code(403).send({ error: "IP is not allowed." });
  }
};

const requireUser = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  try {
    await request.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "Authentication required." });
  }
};

const requireAgentKey = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const token = bearerToken(request.headers.authorization);
  if (!token) {
    await reply.code(401).send({ error: "Agent key is required." });
    return;
  }

  const settings = await prisma.serverSettings.findUnique({ where: { id: "default" } });
  if (!settings || !(await verifySecret(token, settings.agentKeyHash))) {
    await reply.code(401).send({ error: "Invalid agent key." });
  }
};

const ensureBootstrapData = async (config: ServerRuntimeConfig): Promise<void> => {
  await prisma.serverSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      serverAddress: config.settings.serverAddress,
      serverPort: config.settings.serverPort,
      agentKeyHash: await hashSecret(config.settings.agentKey),
      ipListMode: ipModeToDb(config.settings.ipListMode),
      ipAllowlist: JSON.stringify(config.settings.ipAllowlist),
      ipBlocklist: JSON.stringify(config.settings.ipBlocklist),
      publicReadOnly: config.settings.publicReadOnly
    },
    update: {
      serverAddress: config.settings.serverAddress,
      serverPort: config.settings.serverPort,
      ipListMode: ipModeToDb(config.settings.ipListMode),
      ipAllowlist: JSON.stringify(config.settings.ipAllowlist),
      ipBlocklist: JSON.stringify(config.settings.ipBlocklist),
      publicReadOnly: config.settings.publicReadOnly
    }
  });

  await prisma.alertSettings.upsert({
    where: { id: "global" },
    create: { id: "global", ...alertSettingsToDb(config.alerts) },
    update: alertSettingsToDb(config.alerts)
  });

  await prisma.user.upsert({
    where: { username: config.adminUsername },
    create: {
      fullName: "Default Administrator",
      username: config.adminUsername,
      email: "admin@networkuptime.local",
      passwordHash: await hashSecret(config.adminPassword),
      role: "ADMIN"
    },
    update: {}
  });
};

export const buildServer = async (config: ServerRuntimeConfig): Promise<FastifyInstance> => {
  await ensureBootstrapData(config);

  const app = Fastify({
    logger: true,
    trustProxy: true,
    https: config.tls
  } as Parameters<typeof Fastify>[0]) as unknown as FastifyInstance;

  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: {
      cookieName: "networkuptime_session",
      signed: false
    }
  });

  if (existsSync(webIndexPath)) {
    await app.register(staticPlugin, {
      root: path.join(webDistDirectory, "assets"),
      prefix: "/assets/"
    });
  }

  app.addHook("preHandler", enforceIpRules);

  app.get("/health", async () => ({
    ok: true,
    service: "networkuptime-server"
  }));

  app.get("/", async (_request, reply) => {
    if (existsSync(webIndexPath)) {
      return reply.type("text/html").send(readFileSync(webIndexPath, "utf8"));
    }

    return reply.type("text/html").send(renderAppShell());
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });

    if (!user || !(await verifySecret(input.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid username or password." });
    }

    const token = app.jwt.sign({ id: user.id, username: user.username, role: user.role });
    reply.setCookie("networkuptime_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/"
    });

    return { token, user: { id: user.id, username: user.username, role: user.role } };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request) => {
    return { user: request.user };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("networkuptime_session", {
      path: "/"
    });

    return { ok: true };
  });

  app.get("/api/settings/server", { preHandler: requireUser }, async () => {
    const settings = await prisma.serverSettings.findUniqueOrThrow({ where: { id: "default" } });

    return {
      serverAddress: settings.serverAddress,
      serverPort: settings.serverPort,
      ipListMode: ipModeFromDb(settings.ipListMode),
      ipAllowlist: parseJsonList(settings.ipAllowlist),
      ipBlocklist: parseJsonList(settings.ipBlocklist),
      publicReadOnly: settings.publicReadOnly
    };
  });

  app.put("/api/settings/server", { preHandler: requireUser }, async (request) => {
    const input = serverSettingsUpdateSchema.parse(request.body);
    const settings = await prisma.serverSettings.update({
      where: { id: "default" },
      data: {
        serverAddress: input.serverAddress,
        serverPort: input.serverPort,
        ...(input.agentKey ? { agentKeyHash: await hashSecret(input.agentKey) } : {}),
        ipListMode: ipModeToDb(input.ipListMode),
        ipAllowlist: JSON.stringify(input.ipAllowlist),
        ipBlocklist: JSON.stringify(input.ipBlocklist),
        publicReadOnly: input.publicReadOnly
      }
    });

    return {
      serverAddress: settings.serverAddress,
      serverPort: settings.serverPort,
      ipListMode: ipModeFromDb(settings.ipListMode),
      ipAllowlist: parseJsonList(settings.ipAllowlist),
      ipBlocklist: parseJsonList(settings.ipBlocklist),
      publicReadOnly: settings.publicReadOnly
    };
  });

  app.post("/api/agents/register", { preHandler: requireAgentKey }, async (request) => {
    const input = registerAgentSchema.parse(request.body);
    const agent = await prisma.agent.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        name: input.name,
        description: input.description,
        version: input.version,
        sourceIp: clientIp(request),
        lastCheckIn: new Date()
      },
      update: {
        name: input.name,
        description: input.description,
        version: input.version,
        sourceIp: clientIp(request),
        lastCheckIn: new Date(),
        status: "ACTIVE"
      }
    });

    return { agent };
  });

  app.post("/api/agents/:id/check-in", { preHandler: requireAgentKey }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = agentCheckInSchema.parse(request.body);
    const agent = await prisma.agent.update({
      where: { id: params.id },
      data: {
        version: input.version,
        sourceIp: clientIp(request),
        lastCheckIn: input.observedAt ? new Date(input.observedAt) : new Date(),
        status: "ACTIVE"
      }
    });

    return reply.code(202).send({ agent });
  });

  app.get("/api/agents", { preHandler: requireUser }, async () => {
    return {
      agents: await prisma.agent.findMany({ orderBy: { name: "asc" } })
    };
  });

  app.get("/api/agents/:id/monitors", { preHandler: requireAgentKey }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const monitors = await prisma.monitor.findMany({
      where: {
        parentAgentId: params.id,
        type: {
          in: [MonitorType.UP_DOWN, MonitorType.SSL, MonitorType.HTTP_HTTPS]
        }
      },
      orderBy: { friendlyName: "asc" }
    });

    return {
      monitors: monitors.map((monitor) => ({
        id: monitor.id,
        friendlyName: monitor.friendlyName,
        target: monitor.target,
        type:
          monitor.type === MonitorType.SSL
            ? "ssl"
            : monitor.type === MonitorType.HTTP_HTTPS
              ? "http_https"
              : "up_down"
      }))
    };
  });

  app.post("/api/agents/:id/checks", { preHandler: requireAgentKey }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = monitorCheckResultSchema.parse(request.body);
    const monitor = await prisma.monitor.findFirst({
      where: {
        id: input.monitorId,
        parentAgentId: params.id
      }
    });

    if (!monitor) {
      return reply.code(404).send({ error: "Monitor not found for this agent." });
    }

    const status = monitorStatusToDb(input.status);
    const rawDetails = input.rawDetails;
    const expectedResponse = parseJsonRecord(monitor.expectedResponse);
    const httpMatched =
      monitor.type === MonitorType.HTTP_HTTPS
        ? httpSignaturesMatch(expectedResponse ?? {}, rawDetails)
        : input.httpMatched;
    const check = await prisma.monitorCheck.create({
      data: {
        monitorId: input.monitorId,
        status,
        latencyMs: input.latencyMs,
        sslValid: input.sslValid,
        sslExpiresAt: input.sslExpiresAt ? new Date(input.sslExpiresAt) : undefined,
        sslSelfSigned: input.sslSelfSigned,
        httpMatched,
        httpStatusCode: input.httpStatusCode,
        message: input.message,
        rawDetails: rawDetails ? JSON.stringify(rawDetails) : undefined
      }
    });

    if (monitor.type === MonitorType.HTTP_HTTPS && rawDetails && !expectedResponse) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { proposedResponse: JSON.stringify(rawDetails) }
      });
    }

    const effectiveStatus = await evaluateMonitorState(input.monitorId, input.message);

    return reply.code(201).send({ check, effectiveStatus });
  });

  app.get("/api/settings/alerts", { preHandler: requireUser }, async () => {
    const settings = await prisma.alertSettings.findUniqueOrThrow({ where: { id: "global" } });
    return alertSettingsFromDb(settings);
  });

  app.put("/api/settings/alerts", { preHandler: requireUser }, async (request) => {
    const input = alertSettingsSchema.parse(request.body);
    const settings = await prisma.alertSettings.update({
      where: { id: "global" },
      data: alertSettingsToDb(input)
    });

    return alertSettingsFromDb(settings);
  });

  app.get("/api/alerts/events", { preHandler: requireUser }, async () => {
    return {
      events: await prisma.alertEvent.findMany({
        include: { monitor: true },
        orderBy: { createdAt: "desc" },
        take: 50
      })
    };
  });

  app.get("/api/monitors", { preHandler: requireUser }, async () => {
    return {
      monitors: await prisma.monitor.findMany({
        include: {
          parentAgent: true,
          parentMonitor: true,
          checks: {
            orderBy: { checkedAt: "desc" },
            take: 5
          }
        },
        orderBy: { friendlyName: "asc" }
      })
    };
  });

  app.post("/api/monitors/:id/approve-http-signature", { preHandler: requireUser }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: params.id } });
    if (!monitor.proposedResponse) {
      throw new Error("No proposed HTTP signature is available.");
    }

    const updatedMonitor = await prisma.monitor.update({
      where: { id: params.id },
      data: {
        expectedResponse: monitor.proposedResponse,
        proposedResponse: null,
        status: MonitorStatus.UNKNOWN
      }
    });

    return { monitor: updatedMonitor };
  });

  app.post("/api/monitors", { preHandler: requireUser }, async (request, reply) => {
    const input = monitorSchema.parse(request.body);
    const monitor = await prisma.monitor.create({
      data: {
        friendlyName: input.friendlyName,
        description: input.description,
        parentAgentId: input.parentAgentId,
        parentMonitorId: input.parentMonitorId,
        target: input.target,
        type: monitorTypeToDb(input.type),
        overrideSettings: input.overrideSettings ? JSON.stringify(input.overrideSettings) : undefined
      }
    });

    return reply.code(201).send({ monitor });
  });

  app.put("/api/monitors/:id", { preHandler: requireUser }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = monitorSchema.parse(request.body);
    const monitor = await prisma.monitor.update({
      where: { id: params.id },
      data: {
        friendlyName: input.friendlyName,
        description: input.description,
        parentAgentId: input.parentAgentId,
        parentMonitorId: input.parentMonitorId,
        target: input.target,
        type: monitorTypeToDb(input.type),
        overrideSettings: input.overrideSettings ? JSON.stringify(input.overrideSettings) : undefined
      }
    });

    return { monitor };
  });

  app.delete("/api/monitors/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await prisma.monitor.delete({ where: { id: params.id } });
    return reply.code(204).send();
  });

  return app;
};
