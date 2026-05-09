import net from "node:net";
import { performance } from "node:perf_hooks";
import { type AssignedMonitor, type MonitorCheckResult } from "./client.js";

const timeoutMs = 5000;

const parseHostTarget = (target: string): { host: string; port: number } => {
  const [host, port] = target.split(":");
  return {
    host: host ?? target,
    port: port ? Number(port) : 80
  };
};

const tcpCheck = async (target: string): Promise<MonitorCheckResult["rawDetails"]> => {
  const { host, port } = parseHostTarget(target);

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { mode: "tcp", target, timeoutMs };
};

const httpCheck = async (target: string): Promise<MonitorCheckResult["rawDetails"]> => {
  const response = await fetch(target, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.status >= 500) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    mode: "http",
    target,
    statusCode: response.status,
    timeoutMs
  };
};

export const runUpDownCheck = async (monitor: AssignedMonitor): Promise<MonitorCheckResult> => {
  const started = performance.now();

  try {
    const url = URL.canParse(monitor.target) ? new URL(monitor.target) : undefined;
    const rawDetails =
      url && ["http:", "https:"].includes(url.protocol)
        ? await httpCheck(monitor.target)
        : await tcpCheck(monitor.target);
    const latencyMs = Math.round(performance.now() - started);

    return {
      monitorId: monitor.id,
      status: "up",
      latencyMs,
      message: `Reachable in ${latencyMs}ms`,
      rawDetails
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      monitorId: monitor.id,
      status: "down",
      latencyMs,
      message: error instanceof Error ? error.message : "Check failed",
      rawDetails: { target: monitor.target, timeoutMs }
    };
  }
};
