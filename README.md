# GymLog

A strength-training log as quick to fill in as a paper notebook. See `vision.md` for the product, `CONTEXT.md` for the domain language, `docs/adr/` for decisions and `AGENTS.md` for how work is done here.

## Requirements

Node.js 24, npm and Docker Desktop. Docker must be running for `npm run dev` (it starts the database), `npm test` (the sync tests start their own PostgreSQL) and `npm run test:e2e` (so do the end-to-end tests, with a server of their own on port 4176). On Windows, use the WSL 2 backend and limit its memory, e.g. to 4 GB.

## Commands

```bash
npm install             # once, after cloning or pulling new dependencies
npm run dev             # start the database, the server and the app for development
npm run db              # start only the dev database (PostgreSQL in Docker)
npm run owner-invite    # create the Owner's first Invite in the dev database and print its link
npm run owner-password  # print a Reset link for the Owner, in the dev database
npm test                # run the test suite
npm run test:e2e        # run the end-to-end flows in a phone-sized Chromium
npm run typecheck       # check types
```

Before the first `npm run test:e2e`, install its browser once with `npx playwright install chromium`.

After changing the server's database schema (`packages/server/src/db/schema.ts`), write its migration with `npm run db:generate -w @gymlog/server`; the server applies migrations when it starts.

The root `package.json` overrides the esbuild under `@esbuild-kit/core-utils`, which drizzle-kit still pulls in, to 0.25 or newer: the version it asks for, 0.18, has a known vulnerability (GHSA-67mh-4wv8-2f99, #33). Because of the override, `npm ls` marks that esbuild "invalid"; this is expected. Remove the override once drizzle-kit no longer depends on `@esbuild-kit/esm-loader`.

## Signing in for development

On first launch the app asks to sign in, and Users come only from an Invite (ADR 0007). To set up the Owner, run

```bash
npm run owner-invite
```

and open the link it prints: whoever chooses a Login and a password there becomes the Owner. The Owner then creates Invites for others at the bottom of the list of Workouts («Создать приглашение»). Each Invite makes one User, who then signs in with the Login and password on any device.

There is no email. When someone forgets their password, the Owner opens «Аккаунты и пароли» and sends them a Reset link. An Owner who forgot their own runs

```bash
npm run owner-password
```

and opens the link it prints. Users from before passwords (dev databases from #14) keep their old name as the Login and have no password until a Reset link sets one.

## Opening the app from a phone

1. Connect the computer and the phone to the same Wi-Fi.
2. Run `npm run dev`. Vite prints a `Network:` address such as `http://192.168.1.23:5173/`.
3. Open that address in the phone's browser.

If the phone can't connect on Windows, allow Node.js through Windows Defender Firewall for private networks (Windows usually asks the first time the dev server starts), and check that the Wi-Fi network is set to Private.

The phone signs in like any other device, with a login and a password.
