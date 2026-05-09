import {
  checkInAgent,
  fetchAssignedMonitors,
  registerAgent,
  submitMonitorCheck
} from "./client.js";
import { runSslCheck, runUpDownCheck } from "./checks.js";
import { loadAgentConfig } from "./config.js";

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const registerWithRetry = async (
  config: Awaited<ReturnType<typeof loadAgentConfig>>
): Promise<void> => {
  while (true) {
    try {
      await registerAgent(config);
      console.log("Agent registered successfully.");
      return;
    } catch (error) {
      console.error("Agent registration failed; retrying in 10 seconds:", error);
      await sleep(10_000);
    }
  }
};

const main = async (): Promise<void> => {
  const config = await loadAgentConfig();
  console.log(`Starting NetworkUptime agent ${config.name} (${config.id})`);

  await registerWithRetry(config);

  while (true) {
    try {
      await checkInAgent(config);
      console.log(`Check-in completed at ${new Date().toISOString()}`);

      const monitors = await fetchAssignedMonitors(config);
      for (const monitor of monitors) {
        const result = monitor.type === "ssl" ? await runSslCheck(monitor) : await runUpDownCheck(monitor);
        await submitMonitorCheck(config, result);
        console.log(
          `Monitor ${monitor.friendlyName} is ${result.status} (${result.message ?? "no details"})`
        );
      }
    } catch (error) {
      console.error("Check-in failed:", error);
    }

    await sleep(config.checkInIntervalSeconds * 1000);
  }
};

main().catch((error) => {
  console.error("Agent startup failed:", error);
  process.exit(1);
});
