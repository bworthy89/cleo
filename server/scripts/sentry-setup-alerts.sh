#!/usr/bin/env bash
#
# Idempotent setup of Sentry alert rules for the ONAY broadcast server.
# Re-runnable safely — uses upsert-by-name semantics so a second run
# updates existing rules rather than creating duplicates.
#
# Creates:
#   1. Phase 1 GATE alert — sequencer.result with poor_fit:true tag
#      (issue #20 evaluator)
#   2. Cartesia fallback rate — tts.provider-fallback events with to:cartesia
#   3. p95 time-to-slot-zero — Metric Alert on the broadcast.bake transaction
#      (uses transaction.duration as a proxy until a custom metric is wired)
#
# Required env:
#   SENTRY_AUTH_TOKEN  Token with project:write + alerts:write scope.
#                      Create at https://sentry.io/settings/account/api/auth-tokens/
#   SENTRY_ORG         Org slug (visible in URL: sentry.io/organizations/<slug>/)
#   SENTRY_PROJECT     Project slug (e.g., onay-media-server)
#
# Optional env:
#   SENTRY_USER_ID     Sentry user ID for email notifications. If unset,
#                      auto-resolved via /users/me.
#   SENTRY_BASE_URL    Defaults to https://sentry.io. Override for self-hosted.
#
# Dependencies: curl, jq

set -euo pipefail

: "${SENTRY_AUTH_TOKEN:?SENTRY_AUTH_TOKEN is required}"
: "${SENTRY_ORG:?SENTRY_ORG is required}"
: "${SENTRY_PROJECT:?SENTRY_PROJECT is required}"

BASE_URL="${SENTRY_BASE_URL:-https://sentry.io}"
ORG="$SENTRY_ORG"
PROJECT="$SENTRY_PROJECT"
AUTH=(-H "Authorization: Bearer $SENTRY_AUTH_TOKEN")

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed. brew install jq" >&2
  exit 1
fi

# Resolve user ID for email notifications
if [[ -z "${SENTRY_USER_ID:-}" ]]; then
  echo "Resolving Sentry user ID via /users/me..."
  SENTRY_USER_ID=$(curl -fsS "${AUTH[@]}" "$BASE_URL/api/0/users/me/" | jq -r '.id')
  if [[ -z "$SENTRY_USER_ID" || "$SENTRY_USER_ID" == "null" ]]; then
    echo "ERROR: Could not resolve user ID. Check SENTRY_AUTH_TOKEN." >&2
    exit 1
  fi
  echo "  Resolved SENTRY_USER_ID=$SENTRY_USER_ID"
fi

# ────────────────────────────────────────────────────────────────────
# Helper: send a JSON request, print the response body on any 4xx/5xx
# so Sentry's error message reaches the user (the default -fsS
# suppresses the body, leaving you with just "curl: (22) error: 400").
# ────────────────────────────────────────────────────────────────────
api_request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local tmp
  tmp=$(mktemp)
  local status
  if [[ -n "$body" ]]; then
    status=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${AUTH[@]}" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "$url")
  else
    status=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${AUTH[@]}" \
      "$url")
  fi
  if [[ "$status" -ge 400 ]]; then
    echo "    ✗ HTTP $status from $method $url" >&2
    echo "      Response: $(cat "$tmp")" >&2
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

# ────────────────────────────────────────────────────────────────────
# Helper: upsert a project-level Issue Alert by name.
# ────────────────────────────────────────────────────────────────────
upsert_issue_alert() {
  local name="$1"
  local body="$2"

  local existing_id
  existing_id=$(api_request GET \
    "$BASE_URL/api/0/projects/$ORG/$PROJECT/rules/" \
    | jq -r --arg n "$name" '.[] | select(.name == $n) | .id' \
    | head -1)

  if [[ -n "$existing_id" ]]; then
    echo "  [issue] updating '$name' (id=$existing_id)"
    api_request PUT \
      "$BASE_URL/api/0/projects/$ORG/$PROJECT/rules/$existing_id/" \
      "$body" > /dev/null
  else
    echo "  [issue] creating '$name'"
    api_request POST \
      "$BASE_URL/api/0/projects/$ORG/$PROJECT/rules/" \
      "$body" > /dev/null
  fi
  echo "    ✓ $name"
}

# ────────────────────────────────────────────────────────────────────
# Helper: upsert an org-level Metric Alert by name.
# ────────────────────────────────────────────────────────────────────
upsert_metric_alert() {
  local name="$1"
  local body="$2"

  # Gracefully skip when metric alerts are unavailable. Sentry's metric
  # alerts API returns 404 when the org's plan doesn't include them
  # (Developer/free plan excludes Metric Alerts — Team plan or higher
  # required) or when an Organization Auth Token can't access the
  # endpoint. Issue Alerts are sufficient for the Phase 1 GATE; this
  # alert is a "nice to have" until the plan/token upgrade.
  local tmp
  tmp=$(mktemp)
  local list_status
  list_status=$(curl -sS -o "$tmp" -w '%{http_code}' "${AUTH[@]}" \
    "$BASE_URL/api/0/organizations/$ORG/alert-rules/")

  if [[ "$list_status" == "404" ]]; then
    echo "  [metric] skip '$name' — endpoint 404 (metric alerts not available on this plan/token)"
    rm -f "$tmp"
    return 0
  fi
  if [[ "$list_status" -ge 400 ]]; then
    echo "    ✗ HTTP $list_status listing metric alerts" >&2
    echo "      Response: $(cat "$tmp")" >&2
    rm -f "$tmp"
    return 1
  fi

  local existing_id
  existing_id=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .id' "$tmp" | head -1)
  rm -f "$tmp"

  if [[ -n "$existing_id" ]]; then
    echo "  [metric] updating '$name' (id=$existing_id)"
    api_request PUT \
      "$BASE_URL/api/0/organizations/$ORG/alert-rules/$existing_id/" \
      "$body" > /dev/null
  else
    echo "  [metric] creating '$name'"
    api_request POST \
      "$BASE_URL/api/0/organizations/$ORG/alert-rules/" \
      "$body" > /dev/null
  fi
  echo "    ✓ $name"
}

# ────────────────────────────────────────────────────────────────────
# Alert 1: Phase 1 GATE — sequencer poor-fit
# ────────────────────────────────────────────────────────────────────
GATE_NAME="Phase 1 GATE — Sequencer meanDistance >= 0.5"
GATE_BODY=$(cat <<EOF
{
  "name": "$GATE_NAME",
  "actionMatch": "all",
  "filterMatch": "all",
  "frequency": 1440,
  "conditions": [
    {
      "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
      "value": 10,
      "interval": "1d"
    }
  ],
  "filters": [
    {
      "id": "sentry.rules.filters.event_attribute.EventAttributeFilter",
      "attribute": "message",
      "match": "co",
      "value": "sequencer.result"
    },
    {
      "id": "sentry.rules.filters.tagged_event.TaggedEventFilter",
      "key": "poor_fit",
      "match": "eq",
      "value": "true"
    }
  ],
  "actions": [
    {
      "id": "sentry.mail.actions.NotifyEmailAction",
      "targetType": "Member",
      "targetIdentifier": $SENTRY_USER_ID
    }
  ]
}
EOF
)
upsert_issue_alert "$GATE_NAME" "$GATE_BODY"

# ────────────────────────────────────────────────────────────────────
# Alert 2: Cartesia fallback rate
# ────────────────────────────────────────────────────────────────────
CARTESIA_NAME="TTS Cartesia fallback rate elevated"
CARTESIA_BODY=$(cat <<EOF
{
  "name": "$CARTESIA_NAME",
  "actionMatch": "all",
  "filterMatch": "all",
  "frequency": 60,
  "conditions": [
    {
      "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
      "value": 5,
      "interval": "1h"
    }
  ],
  "filters": [
    {
      "id": "sentry.rules.filters.event_attribute.EventAttributeFilter",
      "attribute": "message",
      "match": "co",
      "value": "tts.provider-fallback"
    },
    {
      "id": "sentry.rules.filters.tagged_event.TaggedEventFilter",
      "key": "to",
      "match": "eq",
      "value": "cartesia"
    }
  ],
  "actions": [
    {
      "id": "sentry.mail.actions.NotifyEmailAction",
      "targetType": "Member",
      "targetIdentifier": $SENTRY_USER_ID
    }
  ]
}
EOF
)
upsert_issue_alert "$CARTESIA_NAME" "$CARTESIA_BODY"

# ────────────────────────────────────────────────────────────────────
# Alert 3: p95 time-to-slot-zero (Metric Alert)
#
# IMPORTANT: This uses transaction.duration as a proxy for time-to-slot-
# zero. Sentry Metric Alerts on transactions measure total duration, not
# arbitrary span attributes like our 'bake.time_to_slot_zero_ms'. Until
# a custom metric is wired (Sentry.metrics.distribution), this alert
# fires on overall bake duration p95, which biases toward longer-bake
# vibes. Track the proper fix in issue #23 (server Sentry alignment).
# ────────────────────────────────────────────────────────────────────
P95_NAME="Bake p95 duration > 20s"
P95_BODY=$(cat <<EOF
{
  "name": "$P95_NAME",
  "aggregate": "p95(transaction.duration)",
  "dataset": "transactions",
  "query": "transaction.op:broadcast.bake",
  "timeWindow": 60,
  "thresholdType": 0,
  "resolveThreshold": 15000,
  "triggers": [
    {
      "label": "critical",
      "alertThreshold": 20000,
      "actions": [
        {
          "type": "email",
          "targetType": "user",
          "targetIdentifier": "$SENTRY_USER_ID"
        }
      ]
    }
  ],
  "projects": ["$PROJECT"],
  "environment": null
}
EOF
)
upsert_metric_alert "$P95_NAME" "$P95_BODY"

echo
echo "✓ Sentry alerts configured for $ORG/$PROJECT"
