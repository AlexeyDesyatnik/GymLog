# GymLog

A strength-training log as quick to fill in as a paper notebook. See `vision.md` for the product, `CONTEXT.md` for the domain language, `docs/adr/` for decisions and `AGENTS.md` for how work is done here.

## Requirements

Node.js 24, npm and Docker Desktop. Docker must be running for `npm run dev` (it starts the database), `npm test` (the sync tests start their own PostgreSQL) and `npm run test:e2e` (so do the end-to-end tests, with a server of their own on port 4176). On Windows, use the WSL 2 backend and limit its memory, e.g. to 4 GB.

## Commands

```bash
npm install             # once, after cloning or pulling new dependencies
npm run dev             # start the database, the server and the app for development
npm run db              # start only the dev database (PostgreSQL in Docker)
npm run owner-invite    # create the owner's first Invite in the dev database and print its link
npm run owner-password  # print a link for the owner's new password, in the dev database
npm test                # run the test suite
npm run test:e2e        # run the end-to-end flows in a phone-sized Chromium
npm run typecheck       # check types
```

Before the first `npm run test:e2e`, install its browser once with `npx playwright install chromium`.

After changing the server's database schema (`packages/server/src/db/schema.ts`), write its migration with `npm run db:generate -w @gymlog/server`; the server applies migrations when it starts.

## Signing in for development

On first launch the app asks to sign in, and accounts come only from an Invite (ADR 0007). To set up the owner's account, run

```bash
npm run owner-invite
```

and open the link it prints: whoever chooses a login and a password there becomes the owner. The owner then creates Invites for others at the bottom of the list of Workouts («Создать приглашение»). Each Invite gives one account; a user with an account signs in with the login and password on any device.

There is no email. When someone forgets their password, the owner opens «Аккаунты и пароли» and sends them a link for a new one. An owner who forgot their own runs

```bash
npm run owner-password
```

and opens the link it prints. Accounts from before passwords (dev databases from #14) keep their old name as the login and have no password until such a link sets one.

## Opening the app from a phone

1. Connect the computer and the phone to the same Wi-Fi.
2. Run `npm run dev`. Vite prints a `Network:` address such as `http://192.168.1.23:5173/`.
3. Open that address in the phone's browser.

If the phone can't connect on Windows, allow Node.js through Windows Defender Firewall for private networks (Windows usually asks the first time the dev server starts), and check that the Wi-Fi network is set to Private.

The phone signs in like any other device, with a login and a password.
