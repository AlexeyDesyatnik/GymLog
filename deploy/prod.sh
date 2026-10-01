#!/usr/bin/env bash
# Production at https://easygymlog.ru (#15), run from the developer's computer (Git Bash on
# Windows) with Docker running. See docs/deploy.md.
#
#   deploy/prod.sh deploy           build the current commit and deploy it
#   deploy/prod.sh rollback         go back to the version deployed before the current one
#   deploy/prod.sh owner-invite     print the Owner's first Invite
#   deploy/prod.sh owner-password   print a Reset link for the Owner
#   deploy/prod.sh status           show the containers and which version runs
set -euo pipefail

SERVER="${GYMLOG_SERVER:-deploy@easygymlog.ru}"
# Where the Compose file, the Caddyfile and the .env live on the server.
DIR=/opt/gymlog

cd "$(dirname "$0")/.."

fail() {
  echo "prod.sh: $*" >&2
  exit 1
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
  scp -q deploy/compose.yaml deploy/Caddyfile "$SERVER:$DIR/"

  echo "Starting it"
  on_server "$version" <<'EOF'
set -euo pipefail
version=$1
[ -f .env ] || { echo "No .env in $PWD; see docs/deploy.md" >&2; exit 1; }
image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
[ -n "$(image_id "gymlog:$version")" ] || { echo "gymlog:$version didn't arrive" >&2; exit 1; }
# The version running so far becomes the one to roll back to, unless it is this very one again.
current=$(image_id gymlog:current)
if [ -n "$current" ] && [ "$current" != "$(image_id "gymlog:$version")" ]; then
  docker tag gymlog:current gymlog:previous
fi
docker tag "gymlog:$version" gymlog:current
docker compose up -d --remove-orphans
# Only the current and the previous version are kept.
keep="$(image_id gymlog:current) $(image_id gymlog:previous)"
docker image ls gymlog --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' | while read -r tag id; do
  case " $keep " in *" $id "*) ;; *) docker rmi "$tag" >/dev/null ;; esac
done
docker image prune -f >/dev/null
EOF
  echo "Deployed $version: https://easygymlog.ru"
}

rollback() {
  on_server <<'EOF'
set -euo pipefail
docker image inspect gymlog:previous >/dev/null 2>&1 || { echo "There is no previous version" >&2; exit 1; }
docker tag gymlog:previous gymlog:current
docker compose up -d
EOF
  status
}

status() {
  on_server <<'EOF'
docker compose ps
echo
echo "Versions on the server (current and previous share an ID with the commit they came from):"
docker image ls gymlog --format '{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'
EOF
}

case "${1:-}" in
  deploy) deploy ;;
  rollback) rollback ;;
  owner-invite) ssh "$SERVER" "cd $DIR && docker compose exec -T app node packages/server/src/owner-invite.ts" ;;
  owner-password) ssh "$SERVER" "cd $DIR && docker compose exec -T app node packages/server/src/owner-password.ts" ;;
  status) status ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1 ;;
esac
