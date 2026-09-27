# GymLog

A strength-training log as quick to fill in as a paper notebook. See `vision.md` for the product, `CONTEXT.md` for the domain language, `docs/adr/` for decisions and `AGENTS.md` for how work is done here.

## Requirements

Node.js 24, npm and Docker Desktop. Docker must be running for `npm run dev` (it starts the database), `npm test` (the sync tests start their own PostgreSQL) and `npm run test:e2e` (so do the end-to-end tests, with a server of their own on port 4176). On Windows, use the WSL 2 backend and limit its memory, e.g. to 4 GB.

## Commands

```bash
npm install         # once, after cloning or pulling new dependencies
npm run dev         # start the database, the server and the app for development
npm run db          # start only the dev database (PostgreSQL in Docker)
npm run owner-invite  # create the owner's first Invite in the dev database and print its link
npm test            # run the test suite
npm run test:e2e    # run the end-to-end flows in a phone-sized Chromium
npm run typecheck   # check types
```

Before the first `npm run test:e2e`, install its browser once with `npx playwright install chromium`.

After changing the server's database schema (`packages/server/src/db/schema.ts`), write its migration with `npm run db:generate -w @gymlog/server`; the server applies migrations when it starts.

## Signing in for development

On first launch the app asks to sign in, and accounts come only from an Invite (ADR 0002). To set up the owner's account, run

```bash
npm run owner-invite
```

and open the link it prints. Whoever signs in through it becomes the owner, who then creates Invites for others at the bottom of the list of Workouts («Создать приглашение»). Each Invite gives one account; a user with an account signs in on any device without one.

The dev server has a test sign-in in place of VK ID, never present in production: type any name and tap «Войти». Every browser signed in with the same name is the same user, and its Workouts sync between them; a different name is a different user, who needs an Invite for the first sign-in and sees none of the others' Workouts.

### VK ID

VK ID sign-in needs the app's registration with VK ID. Set `VK_ID_CLIENT_ID` (the app's ID) and `VK_ID_REDIRECT_URL` (the callback registered with VK ID, `http://localhost:5173/api/vk/callback` in development) in `packages/server/.env.development`. Without them, «Войти через VK ID» says it isn't set up, and only the test sign-in works. In production both are required.

## Opening the app from a phone

1. Connect the computer and the phone to the same Wi-Fi.
2. Run `npm run dev`. Vite prints a `Network:` address such as `http://192.168.1.23:5173/`.
3. Open that address in the phone's browser.

If the phone can't connect on Windows, allow Node.js through Windows Defender Firewall for private networks (Windows usually asks the first time the dev server starts), and check that the Wi-Fi network is set to Private.

The phone signs in like any other device. VK ID sends the browser back only to the address registered with it, so on the phone use the test sign-in unless that address is the one the phone opens.
