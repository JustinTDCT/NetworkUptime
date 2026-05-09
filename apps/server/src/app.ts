import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { AlertLevel, AlertRepeat, MonitorStatus, MonitorType, prisma } from "@networkuptime/db";
import {
  agentCheckInSchema,
  bearerToken,
  loginSchema,
  monitorCheckResultSchema,
  monitorSchema,
  registerAgentSchema,
  serverSettingsSchema
} from "@networkuptime/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
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

const alertSettingsToDb = (settings: ServerRuntimeConfig["alerts"]) => ({
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
  httpCycles: settings.httpCycles
});

const parseJsonList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
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

  app.addHook("preHandler", enforceIpRules);

  app.get("/health", async () => ({
    ok: true,
    service: "networkuptime-server"
  }));

  app.get("/", async (_request, reply) => {
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
    const input = serverSettingsSchema.parse(request.body);
    const settings = await prisma.serverSettings.update({
      where: { id: "default" },
      data: {
        serverAddress: input.serverAddress,
        serverPort: input.serverPort,
        agentKeyHash: await hashSecret(input.agentKey),
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
        type: MonitorType.UP_DOWN
      },
      orderBy: { friendlyName: "asc" }
    });

    return {
      monitors: monitors.map((monitor) => ({
        id: monitor.id,
        friendlyName: monitor.friendlyName,
        target: monitor.target,
        type: "up_down"
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
    const check = await prisma.monitorCheck.create({
      data: {
        monitorId: input.monitorId,
        status,
        latencyMs: input.latencyMs,
        message: input.message,
        rawDetails: input.rawDetails ? JSON.stringify(input.rawDetails) : undefined
      }
    });

    await prisma.monitor.update({
      where: { id: input.monitorId },
      data: { status }
    });

    return reply.code(201).send({ check });
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
