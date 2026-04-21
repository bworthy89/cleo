#!/usr/bin/env bash
# chatterbox-benchmark.sh
# Benchmarks Chatterbox Turbo TTS on a cloud GPU rental (Vast.ai RTX 3060).
#
# Usage:
#   bash chatterbox-benchmark.sh /path/to/cleo.wav
#
# The voice reference WAV is mounted into the container and passed as the
# voice parameter so every request uses the same speaker embedding.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VOICE_REF="${1:-}"
if [[ -z "$VOICE_REF" ]]; then
  echo "Usage: bash chatterbox-benchmark.sh /path/to/cleo.wav" >&2
  exit 1
fi

if [[ ! -f "$VOICE_REF" ]]; then
  echo "Error: voice reference file not found: $VOICE_REF" >&2
  exit 1
fi

VOICE_FILENAME="$(basename "$VOICE_REF")"
VOICE_STEM="${VOICE_FILENAME%.*}"

CONTAINER_NAME="chatterbox-bench"
IMAGE="travisvn/chatterbox-tts-api:latest"
HOST_PORT=4123
CONTAINER_PORT=4123
API_URL="http://localhost:${HOST_PORT}/v1/audio/speech"
OUTPUT_DIR="/tmp/chatterbox-bench"
WAIT_TIMEOUT=120   # seconds to wait for server ready
CONSISTENCY_RUNS=3

mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
hr() { printf '%0.s─' {1..70}; echo; }

word_count() {
  echo "$1" | wc -w | tr -d ' '
}

# Run a single TTS request and measure wall-clock time.
# Args: label text output_file
run_tts() {
  local label="$1"
  local text="$2"
  local output_file="$3"

  local wc
  wc="$(word_count "$text")"

  echo
  echo "  Segment : $label"
  echo "  Words   : $wc"
  echo "  Text    : ${text:0:80}$([ ${#text} -gt 80 ] && echo '…')"

  local start end elapsed size_kb
  start="$(date +%s%3N)"

  curl -sS -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg model "chatterbox-turbo" \
      --arg input "$text" \
      --arg voice "$VOICE_STEM" \
      '{model: $model, input: $input, voice: $voice}')" \
    -o "$output_file"

  end="$(date +%s%3N)"
  elapsed=$(( end - start ))

  if [[ ! -s "$output_file" ]]; then
    echo "  RESULT  : FAILED — empty response" >&2
    return 1
  fi

  size_kb=$(( $(wc -c < "$output_file") / 1024 ))
  local elapsed_s
  elapsed_s="$(awk "BEGIN {printf \"%.2f\", $elapsed / 1000}")"

  echo "  Time    : ${elapsed_s}s"
  echo "  Size    : ${size_kb} KB"
  echo "  Saved   : $output_file"

  # Flag slow results
  local threshold_ms=4000
  if (( elapsed > threshold_ms )); then
    echo "  WARNING : Exceeded ${threshold_ms}ms target (${elapsed_s}s)"
  else
    echo "  STATUS  : PASS — under 4s target"
  fi
}

# ---------------------------------------------------------------------------
# 1. GPU info
# ---------------------------------------------------------------------------
hr
echo "CHATTERBOX TURBO — GPU BENCHMARK"
echo "Date   : $(date)"
echo "Voice  : $VOICE_REF"
hr

echo
echo "[ GPU INFO ]"
nvidia-smi --query-gpu=name,memory.total,driver_version,cuda_version \
  --format=csv,noheader,nounits 2>/dev/null \
  | awk -F', ' '{printf "  GPU    : %s\n  VRAM   : %s MiB\n  Driver : %s\n  CUDA   : %s\n", $1, $2, $3, $4}' \
  || echo "  nvidia-smi not available or no GPU detected"

# ---------------------------------------------------------------------------
# 2. Pull image and start container
# ---------------------------------------------------------------------------
echo
echo "[ DOCKER SETUP ]"

# Stop any previous instance
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "  Removing previous container: $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "  Pulling image: $IMAGE"
docker pull "$IMAGE"

echo "  Starting container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --gpus all \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${VOICE_REF}:/voices/${VOICE_FILENAME}:ro" \
  "$IMAGE"

# ---------------------------------------------------------------------------
# 3. Wait for server ready
# ---------------------------------------------------------------------------
echo
echo "[ WAITING FOR SERVER ]"
echo "  Polling ${API_URL} (timeout: ${WAIT_TIMEOUT}s)..."

elapsed_wait=0
until curl -sS -o /dev/null -w "%{http_code}" \
    -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d '{"model":"chatterbox-turbo","input":"ready","voice":"test"}' \
    2>/dev/null | grep -qE "^(200|422|500)"; do
  if (( elapsed_wait >= WAIT_TIMEOUT )); then
    echo "  ERROR: Server did not become ready within ${WAIT_TIMEOUT}s" >&2
    echo "  Container logs:" >&2
    docker logs "$CONTAINER_NAME" --tail 30 >&2
    exit 1
  fi
  printf "  %ds elapsed…\r" "$elapsed_wait"
  sleep 3
  elapsed_wait=$(( elapsed_wait + 3 ))
done
echo "  Server ready after ${elapsed_wait}s"

# ---------------------------------------------------------------------------
# 4. Benchmark segments
# ---------------------------------------------------------------------------
echo
hr
echo "[ BENCHMARKS ]"
hr

# Short — 11 words
SHORT_TEXT="Welcome back to the frequency, you're locked in tonight."

# Medium — ~30 words — typical ONAY pre-song bridge
MEDIUM_TEXT="That last track still has me in a different headspace. This next one keeps that momentum moving — Sade knows exactly how to hold a room without raising her voice. Stay with it."

# Long — ~60 words — full eject transition
LONG_TEXT="And that was The Weeknd doing what he does best — turning 3am into a whole philosophy. We're not slowing down though. Coming at you next is Frank Ocean, and if you know Blonde, you know this is the kind of song that makes you forget you had somewhere to be. Let it wash over you. ONAY stays on."

echo
echo "--- SHORT ---"
run_tts "short" "$SHORT_TEXT" "$OUTPUT_DIR/bench_short.mp3"

echo
echo "--- MEDIUM ---"
run_tts "medium" "$MEDIUM_TEXT" "$OUTPUT_DIR/bench_medium.mp3"

echo
echo "--- LONG ---"
run_tts "long" "$LONG_TEXT" "$OUTPUT_DIR/bench_long.mp3"

# ---------------------------------------------------------------------------
# 5. Consistency test — 3x medium segment
# ---------------------------------------------------------------------------
echo
hr
echo "[ CONSISTENCY TEST — ${CONSISTENCY_RUNS}x medium segment ]"
hr

total_ms=0
for i in $(seq 1 "$CONSISTENCY_RUNS"); do
  output="$OUTPUT_DIR/bench_consistency_${i}.mp3"
  start="$(date +%s%3N)"

  curl -sS -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg model "chatterbox-turbo" \
      --arg input "$MEDIUM_TEXT" \
      --arg voice "$VOICE_STEM" \
      '{model: $model, input: $input, voice: $voice}')" \
    -o "$output"

  end="$(date +%s%3N)"
  run_ms=$(( end - start ))
  total_ms=$(( total_ms + run_ms ))
  run_s="$(awk "BEGIN {printf \"%.2f\", $run_ms / 1000}")"
  size_kb=$(( $(wc -c < "$output") / 1024 ))
  echo "  Run $i: ${run_s}s  |  ${size_kb} KB  |  $output"
done

avg_s="$(awk "BEGIN {printf \"%.2f\", $total_ms / ($CONSISTENCY_RUNS * 1000)}")"
echo
echo "  Average: ${avg_s}s over ${CONSISTENCY_RUNS} runs"

# ---------------------------------------------------------------------------
# 6. VRAM usage post-benchmark
# ---------------------------------------------------------------------------
echo
hr
echo "[ VRAM USAGE (post-benchmark) ]"
hr
nvidia-smi --query-gpu=name,memory.used,memory.total,memory.free \
  --format=csv,noheader,nounits 2>/dev/null \
  | awk -F', ' '{printf "  GPU    : %s\n  Used   : %s MiB\n  Total  : %s MiB\n  Free   : %s MiB\n", $1, $2, $3, $4}' \
  || echo "  nvidia-smi not available"

# Also grab container-reported GPU usage
echo
echo "  Container GPU stats:"
docker stats "$CONTAINER_NAME" --no-stream --format \
  "    CPU: {{.CPUPerc}}  MEM: {{.MemUsage}}" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 7. Summary
# ---------------------------------------------------------------------------
echo
hr
echo "[ OUTPUT FILES ]"
hr
ls -lh "$OUTPUT_DIR"/bench_*.mp3 2>/dev/null \
  | awk '{printf "  %s  %s\n", $5, $NF}' \
  || echo "  No output files found"

echo
echo "[ DONE ]"
echo "  Audio files saved to: $OUTPUT_DIR"
echo "  Play to verify voice quality and check timing consistency."
hr
