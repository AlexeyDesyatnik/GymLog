# Production

GymLog runs at https://easygymlog.ru (`www` redirects there), on a VPS in Russia (ADR 0005): Ubuntu 24.04 at Selectel, which also hosts the domain's DNS.

The server runs three containers with Docker Compose (`deploy/compose.yaml`): the app, PostgreSQL and Caddy, which gets the HTTPS certificates itself (`deploy/Caddyfile`). The app is one image holding the server and the built client, so the two are always the same version. The image is built on the developer's computer and sent to the server over SSH, with no registry. The server holds only `/opt/gymlog` with the Compose file, the Caddyfile, an `.env` with the database's two passwords, and the backup script with its settings (see Backups): no git, Node or sources.

Only Caddy's ports (80 and 443) are open to the internet; PostgreSQL and the app are reached only inside Docker's network. The app connects to PostgreSQL as `gymlog_app`, a role of its own that owns GymLog's database but isn't a superuser, so it can't run programs or read files on the server (#39). Its password is `APP_DATABASE_PASSWORD`. The superuser `gymlog`, whose password is `POSTGRES_PASSWORD`, is only for administration, and the app's container never gets that password. SSH takes keys only. The `postgres` and `caddy` images come from Docker Hub through mirrors, since Docker Hub may be unreachable from Russia.

Everything below runs from the developer's computer in Git Bash, with Docker running and SSH access to the server (`ssh deploy@easygymlog.ru` must work without a password prompt).

## Deploying an update

1. Commit and push to `main`.
2. Run

   ```bash
   deploy/prod.sh deploy
   ```

The script refuses uncommitted changes and commits not pushed to `main`. It builds the image, tags it with the commit hash (e.g. `gymlog:9177403a1b2c`), sends it over SSH, copies the Compose file and the Caddyfile to the server, and restarts the app on the new version. Before that, the new version makes sure the app's database role exists and owns everything in the database. The server applies database migrations as it starts, as that role.

Users get the new version silently, never in the middle of a Workout. A phone learns of it when the app is started or comes back from the background, installs it in the background while the app runs, and opens it the next time the app is started after that, once the app was closed. So the first start after a deploy still shows the old version.

If a new version doesn't start, `deploy` says so and stops: roll back as below.

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

## Security checks

From the developer's computer:

```bash
deploy/prod.sh check
```

It checks from outside what an attacker would try first, and prints `FAIL` for anything wrong:

- HTTPS answers, while PostgreSQL's port 5432 and the app's own port 3000 are closed.
- SSH as `deploy` and as `root` offers no way of signing in but a key.
- The app connects to the database as `gymlog_app`, not a superuser, and its container doesn't know the superuser's password.

Run it after changing anything in `deploy/` or on the server. The same checks by hand, in Git Bash:

```bash
timeout 10 bash -c "exec 3<>/dev/tcp/easygymlog.ru/5432 && printf '\x00\x00\x00\x08\x04\xd2\x16\x2f' >&3 && head -c 1 <&3"; echo
curl -s -m 10 -o /dev/null -w '%{http_code}\n' http://easygymlog.ru:3000/
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password deploy@easygymlog.ru
```

The first asks PostgreSQL for SSL and must print nothing: an open port would answer `S` or `N`. The second must print `000`, no HTTP answer. A plain "does the connection open" check isn't enough: a VPN or proxy on the way may accept a connection to any port itself. The third must end with `Permission denied (publickey)` without asking for a password; the same goes for `root@easygymlog.ru`.

## Backups

Every night at 04:00 Moscow time, a systemd timer on the server (`gymlog-backup.timer`, made by `setup-server.sh`) runs `/opt/gymlog/backup.sh` as `deploy` (#16):

1. `pg_dump` of the database (custom format, without owners and privileges), made while the app runs.
2. The dump is read through to the end with `pg_restore`; a dump that can't be read doesn't count.
3. It goes to Selectel's bucket `gymlog-backup-daily`, which deletes each dump after 30 days by itself and keeps older versions of anything overwritten.
4. Weekly, it is first restored into a throwaway PostgreSQL container (no network, at most 256 MB of memory with swap; about 90 MB at the peak), whose tables and row counts are checked against production, and then goes to Selectel's `gymlog-backup-weekly` and Yandex Object Storage's `gymlog-backup-weekly-yandex`, which keep it for good and keep older versions of anything overwritten. The weekly dump is made on Sunday night, or on the first night after it that a backup succeeds, if Sunday's failed or the server was off.

Each run adds a line to `/opt/gymlog/backups.log`. A failure sends an email at once, with the end of the script's output; each weekly run sends an email that sums the week up, with the test restore's time and memory. The mails come from the notifications mailbox at Yandex Mail, over `smtp.yandex.ru:465` (port 25 is closed at Selectel, and Telegram's API can't be reached from the server). `deploy/prod.sh status` shows the last runs, and both `status` and `deploy` warn when the last good backup is more than a day old.

The server's keys can only upload: Selectel's by the buckets' access policies (`PutObject` only), Yandex's by the role `storage.uploader`, which can't delete. So whoever took the server over couldn't delete the backups, and overwriting one with junk wouldn't lose it either: all three buckets keep older versions of anything overwritten. Nothing is encrypted.

### Keys, and what to keep off the server

Two git-ignored files on the developer's computer, filled in from the password manager:

- `deploy/secrets/backup.env` (from `deploy/backup.env.example`): the upload keys and the notifications mailbox. `deploy/prod.sh backup-setup` sends it to `/opt/gymlog/backup.env` together with the script, and sends a test email.
- `deploy/secrets/restore.env` (from `deploy/restore.env.example`): the keys that read the buckets. It never goes to the server.

A restore after losing the server needs only what is kept elsewhere, in the password manager: the SSH key, the read keys of both storages, and access to the Selectel and Yandex Cloud accounts. The domain is at Selectel too: losing that account would cut `easygymlog.ru` off until it is back, a risk the owner accepted.

### Making a backup now

```bash
deploy/prod.sh backup
```

It runs the same script as the timer, with the same emails.

### Restoring

```bash
deploy/prod.sh backups
deploy/prod.sh restore 2026-10-02
```

`backups` lists the dumps in Selectel (`--from yandex`: in Yandex). `restore` takes a date, from Selectel's daily bucket or else its weekly one (`--from yandex` for Yandex's), or a dump file. It first saves the production database as it is to `deploy/backups/before-restore-<time>.dump`, asks to type `restore`, reads the dump through, stops the app, makes the database anew from the dump, hands it to `gymlog_app` as deploys do, and starts the app. A wrong restore is undone with `deploy/prod.sh restore deploy/backups/before-restore-<time>.dump`.

Once #40 is done, records written after the dump come back from the devices that hold them; until then they are lost on the server, and devices that synced them get out of step with it. What lives only on the server comes back as it was in the dump: Users, Logins, passwords, Invites and sign-in sessions. A device that signed in after the dump signs in again; a User created after the dump has to be invited again.

When things go wrong:

- **Bad data, the server works**: `restore` with the date before it went wrong.
- **The server is lost**: a new VPS, set up as in the next section, deployed, then `restore`, then the A records pointed at it.
- **The Selectel account is lost**: the same at another provider, with `restore <date> --from yandex`; only weekly dumps are there.

## Setting up a new server

Once, for a fresh Ubuntu 24.04 VPS with 1 GB of RAM or more:

1. Point the A records of `easygymlog.ru` and `www.easygymlog.ru` at the server.
2. Check that `ssh root@<server>` works with a key, and keep that session open until step 4 is done: the script turns SSH passwords off.
3. Run

   ```bash
   ssh root@<server> 'bash -s' < deploy/setup-server.sh
   ```

   It adds 1 GB of swap, installs Docker from Ubuntu's packages with the Docker Hub mirrors, creates the `deploy` user (signing in with root's SSH keys), creates `/opt/gymlog` with an `.env` holding random `POSTGRES_PASSWORD` and `APP_DATABASE_PASSWORD`, sets up the nightly backup timer, lets only SSH, HTTP and HTTPS through the firewall, and turns SSH passwords off (`/etc/ssh/sshd_config.d/10-gymlog.conf`): everyone signs in with a key, `root` too.
4. Check that `ssh deploy@easygymlog.ru` works, then deploy as above. The first deploy pulls `postgres` and `caddy`, and Caddy gets the certificates within a minute.
5. Set up the Owner with `deploy/prod.sh owner-invite`, or restore the database as in Backups.
6. Send the backup settings with `deploy/prod.sh backup-setup` and check that the test email arrives.
7. Run `deploy/prod.sh check`.

The script is safe to run again on a server already set up: it adds only what is missing and keeps the passwords there are. An `apt-get` upgrade of Docker on the way may stop the app for a few seconds. A server set up before #39 gets the app's database password and the SSH settings that way: keep an SSH session open, run the script as in step 3, check that a new `ssh deploy@easygymlog.ru` and `ssh root@easygymlog.ru` still let you in, then deploy, which hands the database to the app's role, and run `deploy/prod.sh check`.

If neither mirror in `/etc/docker/daemon.json` works, replace them with one that does and run `systemctl restart docker`.

If SSH ever stops letting you in, Selectel's web console (the server's page in the control panel) still reaches the server. Before changing SSH settings, keep one SSH session open and check a new sign-in from a second one.
