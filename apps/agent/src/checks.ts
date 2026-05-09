import { createHash } from "node:crypto";
import net from "node:net";
import { performance } from "node:perf_hooks";
import tls from "node:tls";
import { type AssignedMonitor, type MonitorCheckResult } from "./client.js";

const timeoutMs = 5000;

const bodyHash = (body: string): string => createHash("sha256").update(body).digest("hex");

const titleFromHtml = (body: string): string => {
  const match = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
};

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

const parseSslTarget = (target: string): { host: string; port: number; servername: string } => {
  const url = URL.canParse(target) ? new URL(target) : undefined;
  if (url) {
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 443,
      servername: url.hostname
    };
  }

  const { host, port } = parseHostTarget(target);
  return {
    host,
    port: port === 80 ? 443 : port,
    servername: host
  };
};

export const runSslCheck = async (monitor: AssignedMonitor): Promise<MonitorCheckResult> => {
  const started = performance.now();

  try {
    const { host, port, servername } = parseSslTarget(monitor.target);
    const certificate = await new Promise<tls.PeerCertificate>((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername,
        rejectUnauthorized: false
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timed out connecting to ${host}:${port}`));
      }, timeoutMs);

      socket.once("secureConnect", () => {
        clearTimeout(timer);
        const peerCertificate = socket.getPeerCertificate();
        socket.end();
        if (!peerCertificate || Object.keys(peerCertificate).length === 0) {
          reject(new Error("No certificate was presented."));
          return;
        }

        resolve(peerCertificate);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const latencyMs = Math.round(performance.now() - started);
    const expiresAt = new Date(certificate.valid_to);
    const now = new Date();
    const certificateWithIssuer = certificate as tls.PeerCertificate & {
      issuerCertificate?: tls.PeerCertificate;
    };
    const selfSigned =
      certificateWithIssuer.issuerCertificate?.fingerprint === certificate.fingerprint ||
      certificate.issuer?.CN === certificate.subject?.CN;
    const valid = expiresAt.getTime() > now.getTime();

    return {
      monitorId: monitor.id,
      status: valid ? "up" : "down",
      latencyMs,
      sslValid: valid,
      sslExpiresAt: expiresAt.toISOString(),
      sslSelfSigned: selfSigned,
      message: valid
        ? `Certificate expires ${expiresAt.toISOString()}`
        : `Certificate expired ${expiresAt.toISOString()}`,
      rawDetails: {
        mode: "ssl",
        target: monitor.target,
        subject: certificate.subject,
        issuer: certificate.issuer,
        validFrom: certificate.valid_from,
        validTo: certificate.valid_to,
        fingerprint: certificate.fingerprint,
        selfSigned
      }
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      monitorId: monitor.id,
      status: "down",
      latencyMs,
      sslValid: false,
      message: error instanceof Error ? error.message : "SSL check failed",
      rawDetails: { target: monitor.target, timeoutMs }
    };
  }
};

export const runHttpContentCheck = async (monitor: AssignedMonitor): Promise<MonitorCheckResult> => {
  const started = performance.now();

  try {
    const response = await fetch(monitor.target, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await response.text();
    const latencyMs = Math.round(performance.now() - started);
    const title = titleFromHtml(body);
    const signature = {
      mode: "http_content",
      target: monitor.target,
      finalUrl: response.url,
      statusCode: response.status,
      title,
      bodyHash: bodyHash(body),
      contentSample: body.replace(/\s+/g, " ").trim().slice(0, 500)
    };

    return {
      monitorId: monitor.id,
      status: response.status >= 500 ? "down" : "up",
      latencyMs,
      httpStatusCode: response.status,
      message: `Scanned HTTP ${response.status}${title ? ` (${title})` : ""}`,
      rawDetails: signature
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      monitorId: monitor.id,
      status: "down",
      latencyMs,
      httpMatched: false,
      message: error instanceof Error ? error.message : "HTTP content check failed",
      rawDetails: { mode: "http_content", target: monitor.target, timeoutMs }
    };
  }
};
