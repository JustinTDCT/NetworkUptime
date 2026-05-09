import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:./networkuptime.db";

if (!databaseUrl.startsWith("file:")) {
  throw new Error("backup:sqlite only supports SQLite DATABASE_URL values that start with file:");
}

const source = resolve(databaseUrl.slice("file:".length));
const destinationDirectory = resolve(process.env.BACKUP_DIR ?? join(dirname(source), "backups"));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(destinationDirectory, `${basename(source)}.${timestamp}.bak`);

await stat(source);
await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);

console.log(`SQLite backup written to ${destination}`);
