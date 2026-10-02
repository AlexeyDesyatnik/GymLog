#!/usr/bin/env bash
# Backs GymLog's database up (#16). The gymlog-backup timer runs it every night at 04:00 Moscow
# time, as deploy, in /opt/gymlog; deploy/prod.sh copies it there with s3.sh. See docs/deploy.md.
#
#   bash backup.sh            make tonight's backup; email the owner if it fails, and weekly
#   bash backup.sh test-mail  send a test email
#
# Every night: a dump of the database, read through to the end, goes to Selectel's daily bucket.
# Weekly it is also restored into a throwaway PostgreSQL first, then goes to Selectel's and
# Yandex's weekly buckets. Each run adds a line to backups.log, which `prod.sh status` shows.
set -euo pipefail
cd "$(dirname "$0")"
# The upload keys and the mailbox (docs/deploy.md).
set -a
. ./backup.env
set +a
. ./s3.sh

today=$(TZ=Europe/Moscow date +%F)
# The weekly dump is made on Sundays, or on the first night after that it can be, so a Sunday that
# failed or was missed while the server was off is made up for.
last_sunday=$(TZ=Europe/Moscow date -d "$today -$(($(TZ=Europe/Moscow date +%u) % 7)) days" +%F)
last_weekly=$( (grep ' ok .*weekly too' backups.log 2>/dev/null || true) | tail -n 1 | cut -c 1-10)
weekly=$([[ $last_weekly < $last_sunday ]] && echo yes || echo no)

# An email from the notifications mailbox to the owner, over Yandex's SMTP; port 25 is closed.
send_mail() {
  local subject=$1 body=$2 message failed=0
  message=$(mktemp)
  # The subject in UTF-8 has to be encoded; curl turns the line ends into CRLF and escapes lines
  # starting with a dot.
  cat > "$message" <<EOF
From: GymLog <$MAIL_FROM>
To: <$MAIL_TO>
Subject: =?UTF-8?B?$(printf %s "$subject" | base64 -w0)?=
Date: $(LC_ALL=C date -R)
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

$body
EOF
  printf 'user = "%s:%s"\n' "$MAIL_FROM" "$MAIL_PASSWORD" |
    curl -sS --ssl-reqd --crlf --max-time 60 -K - --url smtps://smtp.yandex.ru:465 \
      --mail-from "$MAIL_FROM" --mail-rcpt "$MAIL_TO" -T "$message" || failed=$?
  rm -f "$message"
  return "$failed"
}

# How many rows each table holds, one "schema.table rows" a line, in the database psql reaches
# with these arguments.
row_counts() {
  "$@" -At -F ' ' -c "
    SELECT table_schema || '.' || table_name,
      (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
        false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1"
}

# The backup itself, in a bash of its own so that set -e holds; report_backup tells how it went.
# Each step is announced, so the tail of the output says where it stopped.
make_backup() {
  local work dump image check=gymlog-restore-check
  work=$(mktemp -d)
  dump=$work/gymlog.dump
  # Expanded now: the variables are gone by the time the shell exits.
  # shellcheck disable=SC2064
  trap "rm -rf '$work'; docker rm -f $check >/dev/null 2>&1 || true" EXIT

  # Rows are never removed from these tables (records are deleted by tombstones), so a dump made
  # after counting holds at least as many; the test restore checks that.
  local before
  before=$(row_counts docker compose exec -T postgres psql -U gymlog -d gymlog)

  echo "== dump"
  # Owners and privileges are left out, so the dump restores on a server where the app's role
  # doesn't exist yet; a restore hands the database to it afterwards, as deploys do.
  docker compose exec -T postgres pg_dump -U gymlog -d gymlog -Fc --no-owner --no-acl > "$dump"

  echo "== reading the dump through"
  docker compose exec -T postgres pg_restore -f /dev/null < "$dump"

  echo "== uploading to Selectel"
  s3 selectel "$SELECTEL_DAILY/$today.dump" -T "$dump" > /dev/null

  if [ "$weekly" = yes ]; then
    echo "== test restore"
    # The image production runs, in a container with no network and at most 256 MB of memory,
    # swap included, removed on exit.
    image=$(docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q postgres)")
    docker rm -f "$check" >/dev/null 2>&1 || true
    docker run -d --name "$check" --pull never --network none --memory 256m --memory-swap 256m \
      -e POSTGRES_PASSWORD=check "$image" > /dev/null
    # It answers over TCP only once it is set up and restarted for good.
    for _ in $(seq 60); do
      docker exec "$check" pg_isready -q -h 127.0.0.1 -U postgres && break
      sleep 1
    done
    docker exec "$check" pg_isready -q -h 127.0.0.1 -U postgres ||
      { echo "The test restore's PostgreSQL didn't start in a minute" >&2; return 1; }
    local started=$SECONDS
    docker exec -i "$check" pg_restore -U postgres -d postgres --no-owner --no-acl --exit-on-error < "$dump"
    echo "Restored in $((SECONDS - started)) s"
    local restored table rows got
    restored=$(row_counts docker exec "$check" psql -h 127.0.0.1 -U postgres -d postgres)
    while read -r table rows; do
      got=$(awk -v t="$table" '$1 == t { print $2 }' <<< "$restored")
      [ -n "$got" ] || { echo "The restored database has no $table" >&2; return 1; }
      case $table in
        public.records | public.users | public.logins)
          [ "$got" -ge "$rows" ] || { echo "The restored $table has $got rows, production had $rows" >&2; return 1; }
          ;;
      esac
    done <<< "$before"
    echo "Restored rows:"
    sed 's/^/  /' <<< "$restored"
    # The most the container used at any moment, from its own cgroup.
    echo "Most memory the test restore's PostgreSQL used: $(docker exec "$check" cat /sys/fs/cgroup/memory.peak |
      awk '{ printf "%.0f MB", $1 / 1048576 }') of 256 MB"

    echo "== uploading to the weekly buckets"
    s3 selectel "$SELECTEL_WEEKLY/$today.dump" -T "$dump" > /dev/null
    s3 yandex "$YANDEX_WEEKLY/$today.dump" -T "$dump" > /dev/null
  fi

  echo "ok $(stat -c %s "$dump") bytes$([ "$weekly" = yes ] && echo ", weekly too")"
}

# Makes the backup in a bash of its own, notes it in backups.log and tells the owner what they need
# to know.
report_backup() {
  local output result
  # One backup at a time: a run by hand during the timer's would share the files and the container.
  exec 9> backups.lock
  flock -n 9 || { echo "Another backup is running" >&2; return 1; }
  output=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$output'" EXIT
  if bash "$0" make > "$output" 2>&1; then
    cat "$output"
    result=$(tail -n 1 "$output")
    echo "$(TZ=Europe/Moscow date -Iseconds) $result" >> backups.log
    if [ "$weekly" = yes ]; then
      send_mail "GymLog: резервные копии за неделю" "Копии за последние 7 дней:
$(tail -n 7 backups.log)

Проверочное восстановление сегодняшней копии:
$(sed -n '/^== test restore/,/^== uploading to the weekly/p' "$output" | sed '1d;$d')" ||
        echo "The weekly email couldn't be sent" >&2
    fi
  else
    cat "$output" >&2
    echo "$(TZ=Europe/Moscow date -Iseconds) failed" >> backups.log
    send_mail "GymLog: резервная копия за $today не сделана" "Резервная копия базы GymLog за $today не сделана.

Конец вывода скрипта:
$(tail -n 30 "$output")

Последние запуски:
$(tail -n 7 backups.log)

Повторить: deploy/prod.sh backup (docs/deploy.md)." || echo "The email about it couldn't be sent either" >&2
    return 1
  fi
}

case "${1:-}" in
  "") report_backup ;;
  make) make_backup ;;
  test-mail) send_mail "GymLog: проверка уведомлений" "Это проверочное письмо: уведомления о резервных копиях GymLog доходят." ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1 ;;
esac
