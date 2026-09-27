---
status: accepted
---

# Sign-in is by login and password, by invite only

Supersedes ADR 0002. VK ID turned out to be too much for an app of 1–3 users: it needs a VK Business ID profile verified within 60 days, and in development it accepts `localhost` only on port 80. Russian law (part 10 of article 8 of 149-FZ, fined under article 13.55 of the Code of Administrative Offences since July 2026) lets a site authorize users through its own information system when that system is protected and its owner is a Russian citizen with no other citizenship or a Russian legal entity. Most readings count a site's own login and password database as such a system; what the law rules out is relying on foreign services. So users sign in with a login and a password, checked by the server in Russia (ADR 0005). Passwords are kept only as a slow hash. Accounts still come only from an Invite: the first sign-in through it is where the login and password are chosen. There is no email at all: the owner resets a forgotten password with a one-time link, the way Invites work.

## Considered Options

- **VK ID** (ADR 0002): legal and familiar to the users, but it needs the verified business profile and fixed ports. It can come back as a second way in if the app grows.
- **Email for resetting passwords**: a reset link sent to a foreign mailbox such as Gmail is arguably signing in through a foreign service, which is what the law forbids. It would also mean keeping more personal data. With 1–3 users, the owner resetting a password is enough.
- **Phone number with SMS**: one of the methods the law names outright, but it costs money and needs a contract with an SMS provider.

## Consequences

- The legal footing depends on the owner being a Russian citizen with no other citizenship. If the owner of GymLog changes, revisit this decision.
- No court practice settles this reading yet. If it changes, VK ID or a phone number would replace the password, and Invites and accounts would stay as they are.
