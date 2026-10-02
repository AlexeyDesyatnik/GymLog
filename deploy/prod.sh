#!/usr/bin/env bash
# Production at https://easygymlog.ru (#15), run from the developer's computer (Git Bash on
# Windows) with Docker running. See docs/deploy.md.
#
#   deploy/prod.sh deploy           build the current commit and deploy it
#   deploy/prod.sh rollback         go back to the version deployed before the current one
#   deploy/prod.sh owner-invite     print the Owner's first Invite
#   deploy/prod.sh owner-password   print a Reset link for the Owner
#   deploy/prod.sh status           show the containers, which version runs and the last backups
#   deploy/prod.sh check            check from outside that only what should be open is
#   deploy/prod.sh backup-setup     send the backup settings to the server and a test email
#   deploy/prod.sh backup           make a backup now, as the nightly timer does
#   deploy/prod.sh backups [--from yandex]           list the dumps in the storage
#   deploy/prod.sh restore <date|file> [--from yandex]   replace the database with a dump
set -euo pipefail

SERVER="${GYMLOG_SERVER:-deploy@easygymlog.ru}"
# Where the Compose file, the Caddyfile and the .env live on the server.
DIR=/opt/gymlog
# What the nightly backup runs on the server, besides its settings (#16).
BACKUP_FILES=(deploy/backup.sh deploy/s3.sh)

cd "$(dirname "$0")/.."

fail() {
  echo "prod.sh: $*" >&2
  exit 1
}

# Runs one of the server's own commands (packages/server/src) in the app's container, with the
# production database and APP_URL.
on_app() {
  ssh "$SERVER" "cd $DIR && docker compose exec -T app node packages/server/src/$1.ts"
}

# Runs a script on the server, in $DIR.
on_server() {
  ssh "$SERVER" "cd $DIR && bash -s" "$@"
}

deploy() {
  [ -z "$(git status --porcelain)" ] || fail "there are uncommitted changes; commit them and push to main first"
  git fetch --quiet origin main
  git merge-base --is-ancestor HEAD origin/main || fail "this commit isn't on origin/main; push it first"
  local version
  version=$(git rev-parse --short=12 HEAD)

  echo "Building gymlog:$version"
  docker build --platform linux/amd64 --provenance=false --sbom=false -t "gymlog:$version" .

  echo "Sending it to $SERVER"
  docker save "gymlog:$version" | gzip | ssh "$SERVER" "gunzip | docker load"
  scp -q deploy/compose.yaml deploy/Caddyfile "${BACKUP_FILES[@]}" "$SERVER:$DIR/"

  echo "Starting it"
  on_server "$version" <<'EOF'
set -euo pipefail
version=$1
[ -f .env ] || { echo "No .env in $PWD; see docs/deploy.md" >&2; exit 1; }
set -a; . ./.env; set +a
[ -n "${APP_DATABASE_PASSWORD:-}" ] || {
  echo "No APP_DATABASE_PASSWORD in .env; run deploy/setup-server.sh again (docs/deploy.md)" >&2
  exit 1
}
image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
[ -n "$(image_id "gymlog:$version")" ] || { echo "gymlog:$version didn't arrive" >&2; exit 1; }
# The app connects as a role of its own (#39): the new version makes it, and hands it the
# database with all it already holds, before the app starts. Only this one-off run gets the
# superuser's password, from the environment, so it isn't on a command line. It runs on the
# Compose project's network, where postgres is.
docker compose up -d --wait postgres
export DATABASE_SUPERUSER_URL="postgres://gymlog:$POSTGRES_PASSWORD@postgres:5432/gymlog"
docker run --rm --network gymlog_default -e DATABASE_SUPERUSER_URL -e APP_DATABASE_PASSWORD \
  "gymlog:$version" node packages/server/src/app-role.ts || {
  echo "The database wasn't handed to the app's role; the app still runs the version it ran before" >&2
  exit 1
}
# The version running so far becomes the one to roll back to, unless it is this very one again.
current=$(image_id gymlog:current)
if [ -n "$current" ] && [ "$current" != "$(image_id "gymlog:$version")" ]; then
  docker tag gymlog:current gymlog:previous
fi
docker tag "gymlog:$version" gymlog:current
docker compose up -d --remove-orphans --wait --wait-timeout 120 || {
  echo "The new version didn't start; deploy/prod.sh rollback goes back to the previous one" >&2
  exit 1
}
# The Caddyfile may have changed, which up doesn't notice.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
# Only the current and the previous version are kept.
keep="$(image_id gymlog:current) $(image_id gymlog:previous)"
docker image ls gymlog --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' | while read -r tag id; do
  case " $keep " in *" $id "*) ;; *) docker rmi "$tag" >/dev/null ;; esac
done
docker image prune -f >/dev/null
EOF
  echo "Deployed $version: https://easygymlog.ru"
  backup_warning
}

rollback() {
  on_server <<'EOF'
set -euo pipefail
docker image inspect gymlog:previous >/dev/null 2>&1 || { echo "There is no previous version" >&2; exit 1; }
docker tag gymlog:previous gymlog:current
docker compose up -d --wait --wait-timeout 120
EOF
  status
}

status() {
  on_server <<'EOF'
docker compose ps
echo
echo "Versions on the server (current and previous share an ID with the commit they came from):"
docker image ls gymlog --format '{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'
echo
echo "Last backups (backups.log):"
tail -n 7 backups.log 2>/dev/null || echo "none yet"
EOF
  backup_warning
}

# Warns loudly when the last good backup is more than a day old, or there is none. Only warns: a
# deploy that went well stays a success even when the server can't be asked.
backup_warning() {
  local last
  last=$(on_server <<'SCRIPT'
grep ' ok ' backups.log 2>/dev/null | tail -n 1 | cut -d ' ' -f 1
SCRIPT
  ) || { echo "WARNING: couldn't see when the last backup was made" >&2; return 0; }
  if [ -z "$last" ]; then
    echo "WARNING: the server has made no backup yet (docs/deploy.md, Backups)" >&2
  elif [ $(($(date +%s) - $(date -d "$last" +%s))) -gt $((26 * 3600)) ]; then
    echo "WARNING: the last good backup is from $last, more than a day ago; see docs/deploy.md, Backups" >&2
  fi
}

# Sends the upload keys and the mailbox (deploy/secrets/backup.env) and the backup script to the
# server, then a test email.
backup_setup() {
  [ -f deploy/secrets/backup.env ] || fail "no deploy/secrets/backup.env; see docs/deploy.md, Backups"
  scp -q "${BACKUP_FILES[@]}" "$SERVER:$DIR/"
  ssh "$SERVER" "umask 077 && cat > $DIR/backup.env" < deploy/secrets/backup.env
  ssh -n "$SERVER" "cd $DIR && bash backup.sh test-mail"
  echo "Sent a test email; check that it arrived"
}

# The keys that read the backups, which stay on this computer, and the storages they read.
load_read_keys() {
  [ -f deploy/secrets/restore.env ] || fail "no deploy/secrets/restore.env; see docs/deploy.md, Backups"
  set -a
  . deploy/secrets/restore.env
  set +a
  . deploy/s3.sh
}

backups() {
  load_read_keys
  if [ "$1" = yandex ]; then
    echo "Yandex, weekly:"
    s3_dumps yandex "$YANDEX_WEEKLY" | sed 's/^/  /'
  else
    echo "Selectel, daily (30 days):"
    s3_dumps selectel "$SELECTEL_DAILY" | sed 's/^/  /'
    echo "Selectel, weekly:"
    s3_dumps selectel "$SELECTEL_WEEKLY" | sed 's/^/  /'
  fi
}

# Replaces the production database with a dump: a file here, or the dump of a date from the
# storage. The database as it was is saved here first, so a wrong restore can be undone by
# restoring that file.
restore() {
  local source=$1 from=$2 dump saved answer
  [ -n "$source" ] || fail "restore what? A date, as in deploy/prod.sh backups, or a dump file"
  mkdir -p deploy/backups
  if [ -f "$source" ]; then
    dump=$source
  else
    [[ $source =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "$source is neither a file nor a date like 2026-10-02"
    load_read_keys
    dump=deploy/backups/$from-$source.dump
    case $from in
      selectel)
        if ! s3 selectel "$SELECTEL_DAILY/$source.dump" -o "$dump"; then
          echo "Not in the daily bucket; trying the weekly one"
          s3 selectel "$SELECTEL_WEEKLY/$source.dump" -o "$dump" ||
            { rm -f "$dump"; fail "Selectel gave no dump of $source; deploy/prod.sh backups lists them"; }
        fi
        ;;
      yandex)
        s3 yandex "$YANDEX_WEEKLY/$source.dump" -o "$dump" ||
          { rm -f "$dump"; fail "Yandex gave no dump of $source; deploy/prod.sh backups --from yandex lists them"; }
        ;;
    esac
  fi

  saved=deploy/backups/before-restore-$(date +%Y-%m-%dT%H%M%S).dump
  echo "Saving the database on $SERVER as it is now to $saved"
  ssh -n "$SERVER" "cd $DIR && docker compose exec -T postgres pg_dump -U gymlog -d gymlog -Fc --no-owner --no-acl" > "$saved"

  echo
  echo "This replaces everything in the database on $SERVER with $dump ($(wc -c < "$dump") bytes)."
  echo "The app stops for a minute. The database as it is now is in $saved."
  read -r -p "Type restore to go on: " answer
  [ "$answer" = restore ] || fail "nothing changed"

  ssh "$SERVER" "cat > $DIR/restore.dump" < "$dump"
  on_server <<'SCRIPT' || fail "the restore failed; deploy/prod.sh restore $saved puts the database back"
set -euo pipefail
set -a; . ./.env; set +a
trap 'rm -f restore.dump' EXIT
echo "Reading the dump through before touching anything"
docker compose exec -T postgres pg_restore -f /dev/null < restore.dump
docker compose stop app
# A database made anew, so nothing of the old one stays; devices notice it's another one (#40).
# Input from nowhere: this script itself comes on the standard input, which exec would take.
docker compose exec -T postgres dropdb -U gymlog --force gymlog < /dev/null
docker compose exec -T postgres createdb -U gymlog gymlog < /dev/null
docker compose exec -T postgres pg_restore -U gymlog -d gymlog --no-owner --no-acl --exit-on-error < restore.dump
# Handed to the app's role, as every deploy does.
export DATABASE_SUPERUSER_URL="postgres://gymlog:$POSTGRES_PASSWORD@postgres:5432/gymlog"
docker run --rm --network gymlog_default -e DATABASE_SUPERUSER_URL -e APP_DATABASE_PASSWORD \
  gymlog:current node packages/server/src/app-role.ts
docker compose up -d --wait --wait-timeout 120
SCRIPT
  echo "Restored from $dump"
  status
}

# Checks, from this computer, what an attacker would try first (#39); fails if any check does.
check() {
  local host=${SERVER#*@} failed=0 user methods role super password_seen
  pass() { echo "ok    $*"; }
  flunk() {
    echo "FAIL  $*"
    failed=1
  }

  # A VPN or proxy on the way may accept a connection to any port itself, so a port counts as
  # open only when the service behind it answers: PostgreSQL to a request for SSL with S or N,
  # the app with any HTTP answer.
  if [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$host/")" = 200 ]; then
    pass "HTTPS (443) answers"
  else
    flunk "HTTPS (443) doesn't answer, so the checks of closed ports below prove nothing"
  fi
  if timeout 10 bash -c "exec 3<>/dev/tcp/$host/5432 && printf '\x00\x00\x00\x08\x04\xd2\x16\x2f' >&3 &&
    head -c 1 <&3" 2>/dev/null | grep -q '[SN]'; then
    flunk "PostgreSQL answers from the internet on port 5432"
  else
    pass "PostgreSQL doesn't answer from the internet (port 5432)"
  fi
  if [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://$host:3000/")" = 000 ]; then
    pass "the app doesn't answer from the internet but through HTTPS (port 3000)"
  else
    flunk "the app answers from the internet on port 3000"
  fi

  # Turning keys off on our side, the server says which ways of signing in are left: only keys.
  # ssh fails here as it should, which mustn't stop the script.
  for user in deploy root; do
    methods=$(ssh -o BatchMode=yes -o PubkeyAuthentication=no -o ConnectTimeout=10 "$user@$host" true 2>&1 |
      sed -n 's/.*Permission denied (\(.*\)).*/\1/p') || true
    if [ "$methods" = publickey ]; then
      pass "SSH as $user takes keys only"
    else
      flunk "SSH as $user offers: ${methods:-no answer}"
    fi
  done

  # The app's own connection to the database, and whether its container knows the superuser's password.
  read -r role super password_seen < <(on_server <<'EOF'
docker compose exec -T app node --input-type=module -e '
  import pg from "pg";
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query("select current_user as role, rolsuper from pg_roles where rolname = current_user");
  await client.end();
  const passwordSeen = "POSTGRES_PASSWORD" in process.env;
  console.log(rows[0].role, rows[0].rolsuper, passwordSeen);
'
EOF
  ) || true
  if [ "${role:-}" = gymlog_app ] && [ "${super:-}" = false ]; then
    pass "the app connects to the database as $role, not a superuser"
  else
    flunk "the app connects to the database as ${role:-?} (superuser: ${super:-?})"
  fi
  if [ "${password_seen:-}" = false ]; then
    pass "the app's container doesn't know the superuser's password"
  else
    flunk "the app's container knows the superuser's password"
  fi

  return "$failed"
}

# `--from yandex` anywhere among the arguments picks the storage; the rest stay in order.
from=selectel
args=()
while [ $# -gt 0 ]; do
  if [ "$1" = --from ]; then
    [ "${2:-}" = selectel ] || [ "${2:-}" = yandex ] || fail "--from takes selectel or yandex"
    from=$2
    shift 2
  else
    args+=("$1")
    shift
  fi
done
set -- "${args[@]}"

case "${1:-}" in
  deploy) deploy ;;
  rollback) rollback ;;
  owner-invite | owner-password) on_app "$1" ;;
  status) status ;;
  check) check ;;
  backup-setup) backup_setup ;;
  backup) ssh -n "$SERVER" "cd $DIR && bash backup.sh" ;;
  backups) backups "$from" ;;
  restore) restore "${2:-}" "$from" ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1 ;;
esac
