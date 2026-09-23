# TypeScript on client and server

Most of the code is written by an AI agent, and the owner reads TypeScript but does not write much code. That favours the most widespread stack, one language across client and server, and a compiler that catches errors nobody reviews by hand. We use TypeScript everywhere, with a shared package for the domain types and the Plan notation parser, so the client highlights a bad line immediately and the server validates with the same code.

- Client: React + Vite, offline via `vite-plugin-pwa`, local storage in IndexedDB via Dexie.
- Server: Node.js + Fastify, PostgreSQL via Drizzle.
- Tests: Vitest.
- Deployment: one VPS with Docker Compose (app, PostgreSQL, Caddy for HTTPS).

## Considered Options

- **Ready-made sync engines** (PowerSync, ElectricSQL, Zero): rejected. They would also have to be self-hosted in Russia (ADR 0005), while our data is tiny and the conflict rules are simple (ADR 0004), so a small in-house sync is less to run and understand.
- **.NET on the server**: rejected. The owner is out of practice with it too, and it would split the codebase into two languages with no shared parser.
