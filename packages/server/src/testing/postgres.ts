import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

/** The same image and version as the dev database in compose.yaml and the server's. */
export const POSTGRES_IMAGE = "postgres:18-alpine";

declare module "vitest" {
  export interface ProvidedContext {
    /** Connects to the test run's PostgreSQL as a user who may create databases. */
    postgresUrl: string;
  }
}

/** A clean PostgreSQL in Docker, for one test run. */
export interface TestPostgres {
  /** Connects as a user who may create databases. */
  url: string;
  stop(): Promise<void>;
}

/**
 * Starts a clean PostgreSQL in Docker. Its data lives in memory: nothing of a test run needs to
 * survive it, and on Docker Desktop a write to disk now and then takes seconds, long enough for
 * tests to time out.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withTmpFs({ "/var/lib/postgresql": "rw" })
    .start();
  const url = new URL(container.getConnectionUri());
  // Over IPv4, as the dev database: Node tries localhost's IPv6 address first, and Docker
  // Desktop at times stops answering there, which costs each new connection a quarter of a
  // second, or fails it.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return { url: url.href, stop: async () => void (await container.stop()) };
}

let postgres: TestPostgres | undefined;

/** Starts one clean PostgreSQL for the whole test run; each test then gets a database of its own. */
export async function setup(project: TestProject): Promise<void> {
  postgres = await startTestPostgres();
  project.provide("postgresUrl", postgres.url);
}

export async function teardown(): Promise<void> {
  await postgres?.stop();
}
