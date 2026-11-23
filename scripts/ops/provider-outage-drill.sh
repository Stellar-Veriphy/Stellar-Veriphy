#!/usr/bin/env bash
#
# provider-outage-drill.sh
#
# Repeatable drill that simulates a provider outage, validates that the
# expected Prometheus alert fires and that degraded-mode responses are
# returned by the health endpoints, restores the provider, and writes a
# drill results file capturing follow-up improvements.
#
# See docs/operations/provider-outage-drill.md for the documented steps.
#
# Exit codes:
#   0  Drill completed and all assertions passed.
#   1  One or more assertions failed (alert not fired / degraded mode not observed).
#   2  Invalid usage or missing prerequisites.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DRILL_NAME="${DRILL_NAME:-provider-outage}"
DRILL_RESULTS_DIR="${DRILL_RESULTS_DIR:-${REPO_ROOT}/var/drills}"
DRILL_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL_RESULTS_FILE="${DRILL_RESULTS_FILE:-${DRILL_RESULTS_DIR}/${DRILL_NAME}-${DRILL_TIMESTAMP}.md}"

# Health endpoints that must report degraded mode during the drill.
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/health}"
READY_URL="${READY_URL:-http://localhost:8080/ready}"

# Prometheus endpoint used to assert the alert fires.
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
EXPECTED_ALERT="${EXPECTED_ALERT:-ProviderOutageSimulated}"

# Simulated provider failure toggle. The application must honour this flag
# (e.g. read at request time or via a reload) to enter degraded mode.
PROVIDER_FAILURE_FLAG="${PROVIDER_FAILURE_FLAG:-SIMULATE_PROVIDER_OUTAGE}"
PROVIDER_FAILURE_VALUE="${PROVIDER_FAILURE_VALUE:-true}"

# How long to wait for the alert to fire / degraded mode to appear.
ALERT_TIMEOUT_SECONDS="${ALERT_TIMEOUT_SECONDS:-120}"
DEGRADED_TIMEOUT_SECONDS="${DEGRADED_TIMEOUT_SECONDS:-60}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"

# Optional command used to apply the failure flag to a running service.
# If unset, the drill assumes the flag is applied out-of-band (e.g. via a
# config map / feature flag service) and only validates the observable effects.
APPLY_FLAG_CMD="${APPLY_FLAG_CMD:-}"
RESTORE_FLAG_CMD="${RESTORE_FLAG_CMD:-}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# Result tracking
declare -a RESULTS=()
declare -a FOLLOW_UPS=()
DRILL_FAILED=0

record() {
  # record <PASS|FAIL> <description>
  local status="$1"
  local desc="$2"
  RESULTS+=("| ${status} | ${desc} |")
  if [[ "${status}" == "FAIL" ]]; then
    DRILL_FAILED=1
  fi
  log "${status}: ${desc}"
}

add_follow_up() {
  FOLLOW_UPS+=("$1")
}

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
require_cmd curl
require_cmd date

mkdir -p "${DRILL_RESULTS_DIR}"

log "Starting provider outage drill '${DRILL_NAME}' at ${DRILL_TIMESTAMP}"
log "Results will be written to ${DRILL_RESULTS_FILE}"

# ---------------------------------------------------------------------------
# Cleanup / restore (always run, even on failure)
# ---------------------------------------------------------------------------
PROVIDER_RESTORED=0
restore_provider() {
  if [[ "${PROVIDER_RESTORED}" -eq 1 ]]; then
    return
  fi
  log "Restoring provider (clearing ${PROVIDER_FAILURE_FLAG})"
  if [[ -n "${RESTORE_FLAG_CMD}" ]]; then
    if eval "${RESTORE_FLAG_CMD}"; then
      PROVIDER_RESTORED=1
      record PASS "Provider restore command executed"
    else
      record FAIL "Provider restore command failed"
      add_follow_up "Restore command failed; verify provider state manually and harden restore automation."
    fi
  else
    log "No RESTORE_FLAG_CMD configured; assuming provider restored out-of-band."
    PROVIDER_RESTORED=1
  fi
}
trap 'restore_provider || true' EXIT

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------
# Returns 0 if the expected alert is firing in Prometheus.
alert_is_firing() {
  local query
  query="ALERTS{alertname=\"${EXPECTED_ALERT}\",alertstate=\"firing\"}"
  local response
  if ! response="$(curl -fsS --max-time 10 -G \
      --data-urlencode "query=${query}" \
      "${PROMETHEUS_URL}/api/v1/query" 2>/dev/null)"; then
    return 1
  fi
  # Minimal check: response contains a non-empty result array.
  if printf '%s' "${response}" | grep -q '"result":\[\]'; then
    return 1
  fi
  printf '%s' "${response}" | grep -q '"result":\[{' || return 1
  return 0
}

# Returns 0 if the given URL reports a degraded status.
# Degraded is detected via HTTP status (>=500 or 503) or a JSON body
# containing "degraded" / "unavailable".
endpoint_is_degraded() {
  local url="$1"
  local body http_code
  body="$(mktemp)"
  http_code="$(curl -sS --max-time 10 -o "${body}" -w '%{http_code}' "${url}" 2>/dev/null || echo "000")"
  local degraded=1
  if [[ "${http_code}" == "503" || "${http_code}" == "500" ]]; then
    degraded=0
  elif grep -Eqi '"(status|state)"[[:space:]]*:[[:space:]]*"(degraded|unavailable|down)"' "${body}"; then
    degraded=0
  fi
  rm -f "${body}"
  return "${degraded}"
}

wait_for() {
  # wait_for <timeout_seconds> <description> <command...>
  local timeout="$1"; shift
  local desc="$1"; shift
  local elapsed=0
  while (( elapsed < timeout )); do
    if "$@"; then
      return 0
    fi
    sleep "${POLL_INTERVAL_SECONDS}"
    elapsed=$(( elapsed + POLL_INTERVAL_SECONDS ))
  done
  return 1
}

# ---------------------------------------------------------------------------
# Drill steps
# ---------------------------------------------------------------------------

# Step 1: Baseline — confirm provider healthy before injecting failure.
log "Step 1: Verifying baseline (provider healthy)"
if endpoint_is_degraded "${HEALTH_URL}"; then
  record FAIL "Baseline: health endpoint already degraded before drill"
  add_follow_up "Investigate pre-existing degraded state; drill aborted to avoid false positives."
  # Write partial results and exit non-zero.
  DRILL_FAILED=1
else
  record PASS "Baseline: health endpoint reports healthy"
fi

if [[ "${DRILL_FAILED}" -eq 1 ]]; then
  log "Aborting drill due to failed baseline."
  # Fall through to results writing below.
else

  # Step 2: Inject simulated provider failure.
  log "Step 2: Injecting simulated provider failure (${PROVIDER_FAILURE_FLAG}=${PROVIDER_FAILURE_VALUE})"
  if [[ -n "${APPLY_FLAG_CMD}" ]]; then
    if eval "${APPLY_FLAG_CMD}"; then
      record PASS "Provider failure flag applied"
    else
      record FAIL "Provider failure flag could not be applied"
      add_follow_up "Fix APPLY_FLAG_CMD automation so the drill can inject failures reliably."
    fi
  else
    log "No APPLY_FLAG_CMD configured; assuming failure injected out-of-band."
    record PASS "Provider failure assumed injected out-of-band"
  fi

  # Step 3: Assert the expected Prometheus alert fires.
  log "Step 3: Waiting up to ${ALERT_TIMEOUT_SECONDS}s for alert '${EXPECTED_ALERT}' to fire"
  if wait_for "${ALERT_TIMEOUT_SECONDS}" "alert ${EXPECTED_ALERT}" alert_is_firing; then
    record PASS "Alert '${EXPECTED_ALERT}' fired"
  else
    record FAIL "Alert '${EXPECTED_ALERT}' did not fire within ${ALERT_TIMEOUT_SECONDS}s"
    add_follow_up "Review alerting rules for '${EXPECTED_ALERT}': verify threshold, for-duration, and scrape interval."
  fi

  # Step 4: Assert degraded-mode responses from health endpoints.
  log "Step 4: Waiting up to ${DEGRADED_TIMEOUT_SECONDS}s for degraded mode on ${HEALTH_URL}"
  if wait_for "${DEGRADED_TIMEOUT_SECONDS}" "degraded ${HEALTH_URL}" endpoint_is_degraded "${HEALTH_URL}"; then
    record PASS "Health endpoint reports degraded mode"
  else
    record FAIL "Health endpoint did not report degraded mode within ${DEGRADED_TIMEOUT_SECONDS}s"
    add_follow_up "Ensure ${HEALTH_URL} reflects provider outages in its status payload."
  fi

  log "Step 4b: Waiting up to ${DEGRADED_TIMEOUT_SECONDS}s for degraded mode on ${READY_URL}"
  if wait_for "${DEGRADED_TIMEOUT_SECONDS}" "degraded ${READY_URL}" endpoint_is_degraded "${READY_URL}"; then
    record PASS "Readiness endpoint reports degraded mode"
  else
    record FAIL "Readiness endpoint did not report degraded mode within ${DEGRADED_TIMEOUT_SECONDS}s"
    add_follow_up "Ensure ${READY_URL} reflects provider outages so traffic is shed correctly."
  fi

  # Step 5: Restore provider and confirm recovery.
  log "Step 5: Restoring provider"
  restore_provider

  log "Step 5b: Waiting up to ${DEGRADED_TIMEOUT_SECONDS}s for recovery on ${HEALTH_URL}"
  if wait_for "${DEGRADED_TIMEOUT_SECONDS}" "recovered ${HEALTH_URL}" bash -c "! endpoint_is_degraded '${HEALTH_URL}'"; then
    record PASS "Health endpoint recovered after provider restore"
  else
    record FAIL "Health endpoint did not recover within ${DEGRADED_TIMEOUT_SECONDS}s after restore"
    add_follow_up "Investigate slow recovery / stale degraded state after provider restore."
  fi
fi

# ---------------------------------------------------------------------------
# Write results file
# ---------------------------------------------------------------------------
{
  echo "# Provider Outage Drill Results"
  echo
  echo "- **Drill:** ${DRILL_NAME}"
  echo "- **Timestamp (UTC):** ${DRILL_TIMESTAMP}"
  echo "- **Expected alert:** ${EXPECTED_ALERT}"
  echo "- **Health endpoint:** ${HEALTH_URL}"
  echo "- **Readiness endpoint:** ${READY_URL}"
  echo "- **Overall result:** $([[ "${DRILL_FAILED}" -eq 0 ]] && echo "PASS" || echo "FAIL")"
  echo
  echo "## Assertions"
  echo
  echo "| Status | Description |"
  echo "| ------ | ----------- |"
  for r in "${RESULTS[@]}"; do
    echo "${r}"
  done
  echo
  echo "## Follow-up improvements"
  echo
  if [[ "${#FOLLOW_UPS[@]}" -eq 0 ]]; then
    echo "None identified."
  else
    for f in "${FOLLOW_UPS[@]}"; do
      echo "- ${f}"
    done
  fi
  echo
  echo "## Repeatable steps"
  echo
  echo "1. Verify baseline health (provider healthy)."
  echo "2. Inject simulated provider failure via \`${PROVIDER_FAILURE_FLAG}=${PROVIDER_FAILURE_VALUE}\`."
  echo "3. Assert Prometheus alert \`${EXPECTED_ALERT}\` fires."
  echo "4. Assert health and readiness endpoints report degraded mode."
  echo "5. Restore provider and confirm recovery."
  echo "6. Review this results file and action follow-up improvements."
} > "${DRILL_RESULTS_FILE}"

log "Drill results written to ${DRILL_RESULTS_FILE}"

if [[ "${DRILL_FAILED}" -ne 0 ]]; then
  log "Drill FAILED: one or more assertions did not pass."
  exit 1
fi

log "Drill PASSED: alerts and degraded modes validated."
exit 0