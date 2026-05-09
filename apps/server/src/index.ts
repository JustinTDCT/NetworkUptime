import "./types.js";
import { loadConfig } from "./config.js";

const config = await loadConfig();
process.env.DATABASE_URL ??= config.databaseUrl;

const { buildServer } = await import("./app.js");
const app = await buildServer(config);

await app.listen({ host: config.host, port: config.port });
