import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pullAs, startTestServer } from "./testing/devices.ts";

test("someone signing in without an Invite, whom the server doesn't know, is refused", async () => {
  const server = await startTestServer();
  const phone = server.device();

  await expect(phone.signIn("stranger")).rejects.toMatchObject({ refusal: "noInvite" });
});

test("an Invite gives one person an account; anyone else coming with it afterwards is refused", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();
  const alexeysPhone = server.device();
  await alexeysPhone.signIn("alexey", invite);

  const mariasPhone = server.device();

  await expect(mariasPhone.signIn("maria", invite)).rejects.toMatchObject({ refusal: "inviteUsed" });
});

test("two people coming with one Invite at the same moment: only one of them gets an account", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();

  const outcomes = await Promise.allSettled([
    server.device().signIn("alexey", invite),
    server.device().signIn("maria", invite),
  ]);

  expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
});

test("a user with an account signs in on another device without an Invite, and their Workouts are there", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signIn("alexey", await server.ownerInvite());
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.sync.now();

  const computer = server.device();
  await computer.signIn("alexey");

  expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]);
});

test("a user with an account who comes with an unused Invite signs in, and the Invite stays unused", async () => {
  const server = await startTestServer();
  const alexeysPhone = server.device();
  await alexeysPhone.signUp("alexey");
  const invite = await server.ownerInvite();

  await server.device().signIn("alexey", invite);
  const mariasPhone = server.device();
  await mariasPhone.signIn("maria", invite);

  expect(mariasPhone.journal.sync.state()).toMatchObject({ status: "synced" });
});

test("a new user's Exercise catalog starts from the Starter list: an Exercise is found by its Russian name and shown by its English Primary name", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey");

  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.setPlan(workout.id, "жим лёжа 80x5x3\nПриседания со штангой 100x5");

  expect((await phone.journal.getWorkout(workout.id))?.planNotation).toBe("Bench press 80x5x3\nBarbell back squat 100x5");
});

test("the Starter list is copied into a catalog once: signing in again, on any device, adds no second copy", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey");
  const afterSigningUp = await pullAs(phone, server.url);

  await server.device().signIn("alexey");
  const computer = server.device();
  await computer.signIn("alexey");

  const exercises = (await pullAs(computer, server.url)).records.filter((r) => r.type === "exercise");
  expect(exercises.length).toBeGreaterThan(0);
  expect(exercises).toEqual(afterSigningUp.records.filter((r) => r.type === "exercise"));
});

test("whoever signs in through the owner's first Invite, from the server command, is the owner, and their device knows it", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();

  await ownersPhone.signIn("alexey", await server.ownerInvite());

  expect(ownersPhone.journal.sync.state()).toEqual({ status: "synced", owner: true });
});

test("the owner creates an Invite, through which a new user gets an account who isn't the owner", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signIn("alexey", await server.ownerInvite());

  const invite = await ownersPhone.journal.sync.createInvite();
  const mariasPhone = server.device();
  await mariasPhone.signIn("maria", invite);

  expect(mariasPhone.journal.sync.state()).toEqual({ status: "synced", owner: false });
});

test("only the owner can create Invites", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signIn("alexey", await server.ownerInvite());
  const mariasPhone = server.device();
  await mariasPhone.signIn("maria", await ownersPhone.journal.sync.createInvite());
  const stranger = server.device();

  await expect(mariasPhone.journal.sync.createInvite()).rejects.toThrow("403");
  await expect(stranger.journal.sync.createInvite()).rejects.toThrow();
  const invitesAsked = await Promise.all(
    [mariasPhone, stranger].map((device) => device.fetch(`${server.url}/api/invites`, { method: "POST" })),
  );
  expect(invitesAsked.map((response) => response.status)).toEqual([403, 401]);
});

test("a device nobody has ever signed in on says so, even when the server can't be reached, so the app asks to sign in first", async () => {
  const server = await startTestServer();
  const phone = server.device();
  phone.goOffline();

  await expect(phone.journal.sync.now()).rejects.toThrow("offline");

  expect(phone.journal.sync.state()).toEqual({ status: "neverSignedIn" });
});

test("an Invite can be checked before signing in: it is usable until someone gets an account through it", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();
  const phone = server.device();

  const before = await phone.journal.sync.inviteUsable(invite);
  await phone.signIn("maria", invite);
  const after = await server.device().journal.sync.inviteUsable(invite);
  const neverMade = await phone.journal.sync.inviteUsable("no-such-invite");

  expect([before, after, neverMade]).toEqual([true, false, false]);
});
