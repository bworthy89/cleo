#!/usr/bin/env bash
# End-to-end smoke test for the broadcast pipeline.
#
# Usage:
#   export ONAY_TOKEN="<firebase-id-token>"
#   ./server/scripts/test-broadcast.sh
#
# Get a token from the running mobile app:
#   await auth().currentUser?.getIdToken()
#
# Requires: curl, jq, file, afplay (macOS).

set -euo pipefail

HOST="${ONAY_HOST:-http://localhost:3001}"
TOKEN="${ONAY_TOKEN:?ONAY_TOKEN env var required}"
OUT_DIR="${OUT_DIR:-/tmp/onay-broadcast-test}"

mkdir -p "$OUT_DIR"

echo "== Creating broadcast =="
CREATE_RESP="$(curl -sS -X POST "$HOST/broadcast/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playlistId": "test-playlist",
    "vibe": "lateNight",
    "length": "quick",
    "userContext": {
      "timeOfDay": "20:47",
      "dayOfWeek": "Thursday",
      "firstTimeUser": false,
      "listenerName": "Kari"
    },
    "tracks": [
      {"id":"t0","title":"Nikes","artistName":"Frank Ocean","albumTitle":"Blonde","duration":314},
      {"id":"t1","title":"Pyramids","artistName":"Frank Ocean","albumTitle":"Channel Orange","duration":600},
      {"id":"t2","title":"Redbone","artistName":"Childish Gambino","albumTitle":"Awaken, My Love!","duration":306},
      {"id":"t3","title":"Passionfruit","artistName":"Drake","albumTitle":"More Life","duration":298},
      {"id":"t4","title":"Hotline Bling","artistName":"Drake","albumTitle":"Views","duration":267}
    ]
  }')"

echo "$CREATE_RESP" | jq '.manifest | {broadcastId, tracks: (.tracks | length), segmentSlots: (.segmentSlots | length)}, {firstSegmentUrls: .firstSegmentUrls}'

BROADCAST_ID="$(echo "$CREATE_RESP" | jq -r .manifest.broadcastId)"
FIRST_URL="$(echo "$CREATE_RESP" | jq -r .firstSegmentUrls[0])"

if [ "$BROADCAST_ID" = "null" ] || [ -z "$BROADCAST_ID" ]; then
  echo "FAILED: no broadcastId in response"
  echo "$CREATE_RESP" | jq .
  exit 1
fi

echo
echo "== Fetching first segment audio =="
echo "URL: $FIRST_URL"
curl -sSL -H "Authorization: Bearer $TOKEN" "$FIRST_URL" -o "$OUT_DIR/v0.mp3"
file "$OUT_DIR/v0.mp3"

echo
echo "== Polling manifest until all slots ready (up to 60s) =="
for i in $(seq 1 30); do
  MANIFEST="$(curl -sS -H "Authorization: Bearer $TOKEN" "$HOST/broadcast/$BROADCAST_ID/manifest")"
  READY="$(echo "$MANIFEST" | jq '[.segmentSlots[] | select(.status == "ready")] | length')"
  PENDING="$(echo "$MANIFEST" | jq '[.segmentSlots[] | select(.status == "pending")] | length')"
  FAILED="$(echo "$MANIFEST" | jq '[.segmentSlots[] | select(.status == "failed")] | length')"
  TOTAL="$(echo "$MANIFEST" | jq '.segmentSlots | length')"
  printf "  poll %2d: ready=%s pending=%s failed=%s / total=%s\n" "$i" "$READY" "$PENDING" "$FAILED" "$TOTAL"
  if [ "$PENDING" = "0" ]; then break; fi
  sleep 2
done

echo
echo "== Fetching all remaining segments =="
SLOT_COUNT="$(echo "$MANIFEST" | jq '.segmentSlots | length')"
for i in $(seq 1 $((SLOT_COUNT - 1))); do
  SLOT_URL="$(echo "$MANIFEST" | jq -r ".segmentSlots[$i].audioUrls[0] // empty")"
  if [ -z "$SLOT_URL" ]; then
    echo "  slot $i: no audioUrl (failed?)"
    continue
  fi
  curl -sSL -H "Authorization: Bearer $TOKEN" "$SLOT_URL" -o "$OUT_DIR/seg-$i.mp3"
  printf "  slot %d: " "$i"; file "$OUT_DIR/seg-$i.mp3"
done

echo
echo "== Done =="
echo "Segment files in $OUT_DIR/"
echo "Play the cold open: afplay $OUT_DIR/v0.mp3"
