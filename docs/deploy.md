# Production

GymLog runs at https://easygymlog.ru (`www` redirects there), on a VPS in Russia (ADR 0005): Ubuntu 24.04 at Selectel, which also hosts the domain's DNS.

The server runs three containers with Docker Compose (`deploy/compose.yaml`): the app, PostgreSQL and Caddy, which gets the HTTPS certificates itself (`deploy/Caddyfile`). The app is one image holding the server and the built client, so the two are always the same version. The image is built on the developer's computer and sent to the server over SSH, with no registry. The server holds only `/opt/gymlog` with the Compose file, the Caddyfile and an `.env` with `POSTGRES_PASSWORD`: no git, Node or sources. The `postgres` and `caddy` images come from Docker Hub through mirrors, since Docker Hub may be unreachable from Russia.

Everything below runs from the developer's computer in Git Bash, with Docker running and SSH access to the server (`ssh deploy@easygymlog.ru` must work without a password prompt).

## Deploying an update

1. Commit and push to `main`.
2. Run

   ```bash
   deploy/prod.sh deploy
   ```

The script refuses uncommitted changes and commits not pushed to `main`. It builds the image, tags it with the commit hash (e.g. `gymlog:9177403a1b2c`), sends it over SSH, copies the Compose file and the Caddyfile to the server, and restarts the app on the new version. The server applies database migrations as it starts.

Users get the new version silently: their phones install it in the background and open it the next time the app is started, never in the middle of a Workout.

## Rolling back

The server keeps the version deployed before the current one. To go back to it:

```bash
deploy/prod.sh rollback
```

Rolling back twice in a row doesn't go further back: the previous version is the only one kept. Migrations are not undone. That is safe as long as each migration only adds (new tables, new nullable columns); a migration that drops or renames something needs its own plan for rolling back.

To see what runs and which versions the server keeps:

```bash
deploy/prod.sh status
```

## The Owner's commands

They run on the server, with its database:

```bash
deploy/prod.sh owner-invite
deploy/prod.sh owner-password
```

`owner-invite` prints the Owner's first Invite; open its link and choose the Login and password. It is refused once an Owner exists. `owner-password` prints a Reset link for an Owner who forgot their password (ADR 0007).

## Logs

```bash
ssh deploy@easygymlog.ru "cd /opt/gymlog && docker compose logs --tail 100 app"
```

`caddy` and `postgres` in place of `app` show the others' logs.

## Setting up a new server

Once, for a fresh Ubuntu 24.04 VPS with 1 GB of RAM or more:

1. Point the A records of `easygymlog.ru` and `www.easygymlog.ru` at the server.
2. Check that `ssh root@<server>` works with a key.
3. Run

   ```bash
   ssh root@<server> 'bash -s' < deploy/setup-server.sh
   ```

   It adds 1 GB of swap, installs Docker from Ubuntu's packages with the Docker Hub mirrors, creates the `deploy` user (signing in with root's SSH keys), creates `/opt/gymlog` with an `.env` holding a random `POSTGRES_PASSWORD`, and lets only SSH, HTTP and HTTPS through the firewall.
4. Check that `ssh deploy@easygymlog.ru` works, then deploy as above. The first deploy pulls `postgres` and `caddy`, and Caddy gets the certificates within a minute.
5. Set up the Owner with `deploy/prod.sh owner-invite`.

If neither mirror in `/etc/docker/daemon.json` works, replace them with one that does and run `systemctl restart docker`.
