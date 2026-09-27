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

let container: StartedPostgreSqlContainer | undefined;

/** Starts one clean PostgreSQL for the whole test run; each test then gets a database of its own. */
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  project.provide("postgresUrl", container.getConnectionUri());
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
