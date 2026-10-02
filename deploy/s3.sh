# shellcheck shell=bash
# The two S3 storages backups go to (#16), sourced by deploy/backup.sh on the server and by
# deploy/prod.sh on the developer's computer. The keys come from whoever sources it: the server's
# can only upload, the developer's can only read (docs/deploy.md).

# Selectel, where the server is: every night's dump, kept 30 days by the bucket's auto-delete,
# and Sunday's, kept for good.
SELECTEL_ENDPOINT=https://s3.ru-6.storage.selcloud.ru
SELECTEL_REGION=ru-6
SELECTEL_DAILY=gymlog-backup-daily
SELECTEL_WEEKLY=gymlog-backup-weekly
# Yandex Object Storage, another provider in case the Selectel account is lost: Sunday's dump,
# kept for good.
YANDEX_ENDPOINT=https://storage.yandexcloud.net
YANDEX_REGION=ru-central1
YANDEX_WEEKLY=gymlog-backup-weekly-yandex

# One S3 request with curl, signed with the storage's keys from the environment
# (SELECTEL_ACCESS_KEY and SELECTEL_SECRET_KEY, or YANDEX_…). The rest of the arguments go to curl:
#
#   s3 selectel gymlog-backup-daily/2026-10-02.dump -T file    upload
#   s3 yandex gymlog-backup-weekly-yandex/2026-10-04.dump -o file    download
#   s3 selectel 'gymlog-backup-weekly?list-type=2'    list
s3() {
  local storage=$1 path=$2 endpoint region access secret
  shift 2
  case $storage in
    selectel)
      endpoint=$SELECTEL_ENDPOINT region=$SELECTEL_REGION
      access=${SELECTEL_ACCESS_KEY:?} secret=${SELECTEL_SECRET_KEY:?}
      ;;
    yandex)
      endpoint=$YANDEX_ENDPOINT region=$YANDEX_REGION
      access=${YANDEX_ACCESS_KEY:?} secret=${YANDEX_SECRET_KEY:?}
      ;;
    *) echo "s3: no storage $storage" >&2; return 1 ;;
  esac
  # Tried three times, in case the network fails for a moment. Not with curl's --retry: on Windows,
  # curl 8.14 with it says a 404 succeeded.
  local attempt
  for attempt in 1 2 3; do
    # The keys reach curl through its standard input, not the command line, which anyone on the
    # machine could read. The body isn't signed (S3 allows that over HTTPS), so a dump is never
    # read twice.
    printf 'user = "%s:%s"\n' "$access" "$secret" |
      curl -sS --fail-with-body --max-time 600 -K - \
        --aws-sigv4 "aws:amz:$region:s3" -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
        "$@" "$endpoint/$path" && return 0
    [ "$attempt" = 3 ] || sleep 5
  done
  return 1
}

# The names of the dumps in a bucket, oldest first; enough for 1000, about 19 years of Sundays.
s3_dumps() {
  local listing
  listing=$(s3 "$1" "$2?list-type=2")
  # An empty bucket lists no keys, which is no error.
  { grep -o '<Key>[^<]*</Key>' <<< "$listing" || true; } | sed 's/<[^>]*>//g' | sort
}
