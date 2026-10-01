/**
 * Makes the app's own role and hands it the database, with all it already holds (#39), so the
 * app connects as an ordinary role, not as the superuser. Run before the server starts, by
 * deploys and `npm run db`; safe to run again.
 */
import { APP_ROLE, ensureAppRole, handDatabaseToApp } from "./database-role.ts";

/** Connects to GymLog's database as the superuser. */
const superuserUrl = process.env.DATABASE_SUPERUSER_URL;
if (!superuserUrl) throw new Error("DATABASE_SUPERUSER_URL is not set");
const password = process.env.APP_DATABASE_PASSWORD;
if (!password) throw new Error("APP_DATABASE_PASSWORD is not set");

await ensureAppRole(superuserUrl, password);
await handDatabaseToApp(superuserUrl);
console.log(`The database belongs to ${APP_ROLE}, which the app connects as`);
