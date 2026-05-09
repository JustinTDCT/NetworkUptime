import { afterEach, describe, expect, it, vi } from "vitest";
import { runHttpContentCheck, runUpDownCheck } from "./checks.js";
import { type AssignedMonitor } from "./client.js";

const monitor = (target: string, type: AssignedMonitor["type"] = "http_https"): AssignedMonitor => ({
  id: "00000000-0000-4000-8000-000000000101",
  friendlyName: "Test monitor",
  target,
  type
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runHttpContentCheck", () => {
  it("captures a stable HTTP content signature", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><head><title>Example App</title></head><body>OK</body></html>", {
        status: 200
      }))
    );

    const result = await runHttpContentCheck(monitor("https://example.test"));

    expect(result.status).toBe("up");
    expect(result.httpStatusCode).toBe(200);
    expect(result.rawDetails).toMatchObject({
      mode: "http_content",
      target: "https://example.test",
      statusCode: 200,
      title: "Example App"
    });
    expect(result.rawDetails?.bodyHash).toEqual(expect.any(String));
    expect(result.message).toContain("Scanned HTTP 200");
  });

  it("reports failed HTTP scans as down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );

    const result = await runHttpContentCheck(monitor("https://offline.test"));

    expect(result.status).toBe("down");
    expect(result.httpMatched).toBe(false);
    expect(result.message).toBe("connection refused");
  });
});

describe("runUpDownCheck", () => {
  it("marks HTTP 5xx responses as down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));

    const result = await runUpDownCheck(monitor("https://example.test", "up_down"));

    expect(result.status).toBe("down");
    expect(result.message).toBe("HTTP 503");
  });
});
