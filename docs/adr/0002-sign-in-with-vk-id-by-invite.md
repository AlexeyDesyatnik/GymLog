---
status: superseded by ADR-0007
---

# Sign-in is VK ID, by invite only

Russian law forbids authorizing users through non-Russian services, so Google, Apple and similar sign-in providers are ruled out. Users sign in with VK ID, which most of the intended users already have. Accounts are created only through an Invite: the first VK sign-in through the one-time link creates the account and binds the VK ID to it. There is no fallback sign-in method for now; any added later has to meet the same legal constraint.
