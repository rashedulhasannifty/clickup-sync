#!/usr/bin/env bash
# Renders /opt/clickup-sync/datastores.env from the deploy's shared/.env. Runs as root, as the
# ExecStartPre of clickup-sync-datastores.service. Copies only the keys the datastores need so a
# deploy-user-writable file cannot steer a root-run compose. Values are single-quoted (literal).
set -euo pipefail

SRC="${CLICKUP_SHARED_ENV:-/srv/clickup-sync/shared/.env}"
DST="${CLICKUP_DATASTORES_ENV:-/opt/clickup-sync/datastores.env}"
KEYS=(POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB)

[[ -f "$SRC" ]] || { echo "✖ $SRC not found" >&2; exit 1; }

umask 077
tmp="$(mktemp "${DST}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

for key in "${KEYS[@]}"; do
  line="$(grep -m1 "^${key}=" "$SRC" || true)"
  value="${line#*=}"
  [[ -n "$line" && -n "$value" ]] || { echo "✖ $key missing or empty in $SRC" >&2; exit 1; }
  [[ "$value" != *"'"* ]] || { echo "✖ $key contains a single quote" >&2; exit 1; }
  printf "%s='%s'\n" "$key" "$value" >> "$tmp"
done

mv "$tmp" "$DST"
trap - EXIT
chmod 600 "$DST"
