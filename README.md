# GymLog

A strength-training log as quick to fill in as a paper notebook. See `vision.md` for the product, `CONTEXT.md` for the domain language, `docs/adr/` for decisions and `AGENTS.md` for how work is done here.

## Requirements

Node.js 24 and npm.

## Commands

```bash
npm install         # once, after cloning or pulling new dependencies
npm run dev         # start the app for development
npm test            # run the test suite
npm run typecheck   # check types
```

## Opening the app from a phone

1. Connect the computer and the phone to the same Wi-Fi.
2. Run `npm run dev`. Vite prints a `Network:` address such as `http://192.168.1.23:5173/`.
3. Open that address in the phone's browser.

If the phone can't connect on Windows, allow Node.js through Windows Defender Firewall for private networks (Windows usually asks the first time the dev server starts), and check that the Wi-Fi network is set to Private.

Data recorded this way lives only in that phone's browser until sync is built.
