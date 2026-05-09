import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { type PrismaClient } from "@networkuptime/db";
import { alertSettingsSchema } from "@networkuptime/shared";
import { type ServerRuntimeConfig } from "./config.js";

const rootDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const agentKey = "00000000-0000-4000-8000-000000000201";
const adminPassword = "NetworkUptimeTest123";

let app: FastifyInstance;
let prisma: PrismaClient;
let tempDirectory: string;

const config: ServerRuntimeConfig = {
  host: "127.0.0.1",
  port: 0,
  jwtSecret: "test-jwt-secret",
  adminUsername: "admin",
  adminPassword,
  databaseUrl: "",
  settings: {
    serverAddress: "https://localhost:8443",
    serverPort: 8443,
    agentKey,
    ipListMode: "allow_all_blocklist",
    ipAllowlist: [],
    ipBlocklist: [],
    publicReadOnly: false
  },
  alerts: alertSettingsSchema.parse({
    upDownWarningCycles: 1,
    upDownDownCycles: 2,
    httpCycles: 1
  })
};

const login = async (): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: adminPassword
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
};

const registerAgent = async (): Promise<string> => {
  const agentId = "00000000-0000-4000-8000-000000000202";
  const response = await app.inject({
    method: "POST",
    url: "/api/agents/register",
    headers: { authorization: `Bearer ${agentKey}` },
    payload: {
      id: agentId,
      name: "Test Agent",
      description: "Test agent",
      version: "0.1.0"
    }
  });

  expect(response.statusCode).toBe(200);
  return agentId;
};

beforeAll(async () => {
  tempDirectory = mkdtempSync(join(tmpdir(), "networkuptime-server-test-"));
  const databaseUrl = `file:${join(tempDirectory, "networkuptime-test.db")}`;
  process.env.DATABASE_URL = databaseUrl;
  config.databaseUrl = databaseUrl;

  execFileSync("pnpm", ["--filter", "@networkuptime/db", "prisma:migrate:deploy"], {
    cwd: rootDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe"
  });

  const dbModule = await import("@networkuptime/db");
  prisma = dbModule.prisma;
  const appModule = await import("./app.js");
  app = await appModule.buildServer(config);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("server API", () => {
  it("requires authentication for server routes and allows login", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/agents" });
    expect(unauthenticated.statusCode).toBe(401);

    const token = await login();
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({ agents: [] });

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(session.statusCode).toBe(200);
    expect(session.json<{ user: { username: string; role: string } }>().user).toMatchObject({
      username: "admin",
      role: "ADMIN"
    });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout"
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("networkuptime_session=;");
  });

  it("registers an agent and assigns created monitors", async () => {
    const token = await login();
    const agentId = await registerAgent();

    const createMonitor = await app.inject({
      method: "POST",
      url: "/api/monitors",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        friendlyName: "Ping test",
        description: "Reachability",
        parentAgentId: agentId,
        parentMonitorId: "",
        target: "example.com:443",
        type: "up_down"
      }
    });

    expect(createMonitor.statusCode).toBe(201);

    const assignments = await app.inject({
      method: "GET",
      url: `/api/agents/${agentId}/monitors`,
      headers: { authorization: `Bearer ${agentKey}` }
    });

    expect(assignments.statusCode).toBe(200);
    expect(assignments.json<{ monitors: Array<{ friendlyName: string; type: string }> }>().monitors).toEqual(
      expect.arrayContaining([expect.objectContaining({ friendlyName: "Ping test", type: "up_down" })])
    );
  });

  it("moves up/down monitors through warning and down thresholds", async () => {
    const token = await login();
    const agentId = await registerAgent();
    const createMonitor = await app.inject({
      method: "POST",
      url: "/api/monitors",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        friendlyName: "State transition test",
        description: "",
        parentAgentId: agentId,
        parentMonitorId: "",
        target: "example.com:443",
        type: "up_down"
      }
    });
    const monitorId = createMonitor.json<{ monitor: { id: string } }>().monitor.id;

    const firstFailure = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/checks`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        monitorId,
        status: "down",
        message: "first failure"
      }
    });

    expect(firstFailure.statusCode).toBe(201);
    expect(firstFailure.json<{ effectiveStatus: string }>().effectiveStatus).toBe("WARNING");

    const secondFailure = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/checks`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        monitorId,
        status: "down",
        message: "second failure"
      }
    });

    expect(secondFailure.statusCode).toBe(201);
    expect(secondFailure.json<{ effectiveStatus: string }>().effectiveStatus).toBe("DOWN");
  });

  it("stores, approves, and matches HTTP content signatures", async () => {
    const token = await login();
    const agentId = await registerAgent();
    const signature = {
      mode: "http_content",
      target: "https://example.test",
      finalUrl: "https://example.test/",
      statusCode: 200,
      title: "Example",
      bodyHash: "abc123",
      contentSample: "ok"
    };
    const createMonitor = await app.inject({
      method: "POST",
      url: "/api/monitors",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        friendlyName: "HTTP content test",
        description: "",
        parentAgentId: agentId,
        parentMonitorId: "",
        target: "https://example.test",
        type: "http_https"
      }
    });
    const monitorId = createMonitor.json<{ monitor: { id: string } }>().monitor.id;

    const scan = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/checks`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        monitorId,
        status: "up",
        httpStatusCode: 200,
        message: "Scanned HTTP 200",
        rawDetails: signature
      }
    });

    expect(scan.statusCode).toBe(201);
    expect(scan.json<{ effectiveStatus: string }>().effectiveStatus).toBe("UNKNOWN");

    const scannedMonitor = await prisma.monitor.findUniqueOrThrow({ where: { id: monitorId } });
    expect(scannedMonitor.proposedResponse).toBe(JSON.stringify(signature));

    const approve = await app.inject({
      method: "POST",
      url: `/api/monitors/${monitorId}/approve-http-signature`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(approve.statusCode).toBe(200);

    const match = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/checks`,
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        monitorId,
        status: "up",
        httpStatusCode: 200,
        message: "Scanned HTTP 200",
        rawDetails: signature
      }
    });

    expect(match.statusCode).toBe(201);
    expect(match.json<{ effectiveStatus: string }>().effectiveStatus).toBe("UP");

    const latestCheck = await prisma.monitorCheck.findFirstOrThrow({
      where: { monitorId },
      orderBy: { checkedAt: "desc" }
    });
    expect(latestCheck.httpMatched).toBe(true);
  });
});
