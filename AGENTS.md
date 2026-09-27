# GymLog

## Agent skills

### Issue tracker

Issues live as GitHub issues in `AlexeyDesyatnik/GymLog`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Testing

Logic is built test-first with the `tdd` skill: one failing test, the minimal code to pass it, repeat. The owner does not review code line by line, so tests are how correctness is shown. Test names use the language of `CONTEXT.md`.

### Pre-agreed seams

Tests are written only at these seams; everything else is exercised through them, never tested on its own. Adding a seam needs the owner's agreement.

1. **Journal module** (client domain logic behind one public interface, on a real in-memory IndexedDB): Plan notation (enter Plan text, read back Entries and Sets), Workout operations (confirming, editing and adding Sets, Substitute, Finished and undoing it, the derived Not performed and replaced states), Templates and number prefill, and the Exercise catalog (implicit creation, lookup by any name, suggestion ranking, Merge, refusing to delete an Exercise with history).
2. **Sync end to end**: two Journal instances ↔ the real server ↔ real PostgreSQL (no database fakes; VK ID sign-in replaced by a test sign-in). Covers resending without duplicates, last write wins, deleting wins over editing, offline → online, Invites, and **data isolation**: a user can never read or change another user's data.
3. **End-to-end** (Playwright, mobile viewport), a few key flows only: plan → confirm Sets → finish; record offline → sync.

### Not covered by tests

UI layout, the feel of the phone keyboard and behavior on real devices are checked by the owner's manual acceptance on a phone. Every issue ends with an acceptance scenario.

### Docker

The sync tests (seam 2) and the dev server need Docker running: the tests start a clean PostgreSQL per run through Testcontainers, and `npm run dev` starts the dev database from `compose.yaml`. Tests of the Journal alone (seam 1) don't need it.

### CI

GitHub Actions runs typechecking and the full test suite on every PR.
