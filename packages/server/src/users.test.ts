import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pullAs, startTestServer } from "./testing/devices.ts";

test("someone who isn't a User can't sign in: an unknown login is refused like a wrong password", async () => {
  const server = await startTestServer();
  const phone = server.device();

  await expect(phone.signIn("stranger")).rejects.toMatchObject({ refusal: "wrongPassword" });
});

test("an Invite makes a User with the Login and password chosen, which then sign in on another device, where the User's Workouts are", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey", { invite: await server.ownerInvite(), password: "squat 100 x 5" });
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.sync.now();

  const computer = server.device();
  await computer.signIn("alexey", "squat 100 x 5");

  expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]);
});

test("a wrong password is refused, like an unknown login", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey", { password: "squat 100 x 5" });

  await expect(server.device().signIn("alexey", "squat 100 x 6")).rejects.toMatchObject({ refusal: "wrongPassword" });
});

test("an Invite makes one User; anyone else coming with it afterwards is refused", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();
  await server.device().signUp("alexey", { invite });

  const mariasPhone = server.device();

  await expect(mariasPhone.signUp("maria", { invite })).rejects.toMatchObject({ refusal: "inviteUnusable" });
});

test("two people coming with one Invite at the same moment: only one of them becomes a User", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();

  const outcomes = await Promise.allSettled([
    server.device().signUp("alexey", { invite }),
    server.device().signUp("maria", { invite }),
  ]);

  expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
});

test("a login already taken, in any case, is refused, and the Invite stays usable for another login", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey");
  const invite = await server.inviteFromOwner();

  const phone = server.device();
  await expect(phone.signUp(" Alexey ", { invite })).rejects.toMatchObject({ refusal: "loginTaken" });
  await phone.signUp("maria", { invite });

  expect(phone.journal.sync.state()).toEqual({ status: "synced", owner: false });
});

test("a password shorter than 8 characters is refused, and the Invite stays usable", async () => {
  const server = await startTestServer();
  const invite = await server.inviteFromOwner();
  const phone = server.device();

  await expect(phone.signUp("maria", { invite, password: "1234567" })).rejects.toThrow("400");

  expect(await phone.journal.access.inviteUsable(invite)).toBe(true);
});

test("after 5 wrong passwords for a login, even the right one is refused for a while; other logins aren't held up", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey");
  await server.device().signUp("maria");
  const guesser = server.device();
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(guesser.signIn("alexey", `guess ${attempt} of 5`)).rejects.toMatchObject({ refusal: "wrongPassword" });
  }

  await expect(server.device().signIn("alexey")).rejects.toMatchObject({ refusal: "tooManyAttempts" });
  await server.device().signIn("maria");
});

test("wrong passwords sent all at the same moment are held up alike: of 10 at once, only 5 get checked", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey");

  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => server.device().signIn("alexey", `guess ${i + 1} of 10`)),
  );

  const refusals = outcomes.map((o) => (o.status === "rejected" ? (o.reason as { refusal?: string }).refusal : "in"));
  expect(refusals.filter((r) => r === "wrongPassword")).toHaveLength(5);
  expect(refusals.filter((r) => r === "tooManyAttempts")).toHaveLength(5);
});

test("a new user's Exercise catalog starts from the Starter list: an Exercise is found by its Russian name and shown by its English Primary name", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey");

  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.setPlan(workout.id, "жим лёжа 80x5x3\nПриседания со штангой 100x5");

  expect((await phone.journal.getWorkout(workout.id))?.planNotation).toBe(
    "Bench press 80x5x3\nBarbell back squat 100x5",
  );
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

test("whoever becomes a User through the Owner's first Invite, from the server command, is the Owner, and their device knows it", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();

  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });

  expect(ownersPhone.journal.sync.state()).toEqual({ status: "synced", owner: true });
});

test("the Owner creates an Invite, through which a new User comes who isn't the Owner", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });

  const invite = await ownersPhone.journal.access.createInvite();
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria", { invite });

  expect(mariasPhone.journal.sync.state()).toEqual({ status: "synced", owner: false });
});

test("only the owner can create Invites", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria", { invite: await ownersPhone.journal.access.createInvite() });
  const stranger = server.device();

  await expect(mariasPhone.journal.access.createInvite()).rejects.toThrow("403");
  await expect(stranger.journal.access.createInvite()).rejects.toThrow();
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

test("an Invite can be checked before it is used: it is usable until someone becomes a User through it", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();
  const phone = server.device();

  const before = await phone.journal.access.inviteUsable(invite);
  await phone.signUp("maria", { invite });
  const after = await server.device().journal.access.inviteUsable(invite);
  const neverMade = await phone.journal.access.inviteUsable("no-such-invite");

  expect([before, after, neverMade]).toEqual([true, false, false]);
});

test("once there is an owner, the server command makes no more of the owner's Invites", async () => {
  const server = await startTestServer();
  const unused = await server.ownerInvite();
  await server.device().signUp("alexey", { invite: await server.ownerInvite() });

  await expect(server.ownerInvite()).rejects.toThrow("already has an owner");
  await expect(server.device().signUp("maria", { invite: unused })).rejects.toMatchObject({
    refusal: "inviteUnusable",
  });
});

test("the Owner sees the Users by Login", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  await server.device().signUp("maria", { invite: await ownersPhone.journal.access.createInvite() });

  const users = await ownersPhone.journal.access.users();

  expect(users.map(({ login, owner, hasPassword }) => ({ login, owner, hasPassword }))).toEqual([
    { login: "alexey", owner: true, hasPassword: true },
    { login: "maria", owner: false, hasPassword: true },
  ]);
});

test("the Owner's Reset link sets a new password once: the old one stops working, and the User's other devices are signed out", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  const mariasPhone = server.device();
  const invite = await ownersPhone.journal.access.createInvite();
  await mariasPhone.signUp("maria", { invite, password: "old password" });
  const maria = (await ownersPhone.journal.access.users()).find((a) => a.login === "maria")!;

  const resetLink = await ownersPhone.journal.access.createResetLink(maria.userId);
  const earlierResetLink = await ownersPhone.journal.access.createResetLink(maria.userId);
  const mariasComputer = server.device();
  expect(await mariasComputer.journal.access.resetLinkLogin(resetLink)).toBe("maria");
  await mariasComputer.journal.access.setNewPassword(resetLink, "new password");
  await mariasPhone.journal.sync.now();

  expect(mariasComputer.journal.sync.state()).toEqual({ status: "synced", owner: false });
  expect(mariasPhone.journal.sync.state()).toEqual({ status: "signedOut" });
  await expect(server.device().signIn("maria", "old password")).rejects.toMatchObject({ refusal: "wrongPassword" });
  await server.device().signIn("maria", "new password");
  await expect(server.device().journal.access.setNewPassword(resetLink, "third password")).rejects.toMatchObject({
    refusal: "resetLinkUnusable",
  });
  expect(await server.device().journal.access.resetLinkLogin(resetLink)).toBeNull();
  // Any other Reset link of hers given before ends with it.
  expect(await server.device().journal.access.resetLinkLogin(earlierResetLink)).toBeNull();
});

test("only the Owner can see the Users and create Reset links", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria", { invite: await ownersPhone.journal.access.createInvite() });
  const [owner] = await ownersPhone.journal.access.users();
  const stranger = server.device();

  const asked = await Promise.all(
    [mariasPhone, stranger].flatMap((device) => [
      device.fetch(`${server.url}/api/users`),
      device.fetch(`${server.url}/api/reset-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: owner!.userId }),
      }),
    ]),
  );

  expect(asked.map((response) => response.status)).toEqual([403, 403, 401, 401]);
});

test("the server command gives the Owner a Reset link of their own", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey", { invite: await server.ownerInvite(), password: "forgotten password" });

  const resetLink = await server.ownerResetLink();
  await server.device().journal.access.setNewPassword(resetLink, "remembered password");

  const phone = server.device();
  await phone.signIn("alexey", "remembered password");
  expect(phone.journal.sync.state()).toEqual({ status: "synced", owner: true });
});

test("the server command gives no Reset link while there is no Owner", async () => {
  const server = await startTestServer();

  await expect(server.ownerResetLink()).rejects.toThrow("no owner");
});
