#!/usr/bin/env bash
#
# restore-test.sh - Automated backup restore test for representative
# production and staging data sets.
#
# This script provisions an ISOLATED restore environment, restores a
# representative backup, verifies key record counts and integrity checks
# against expected values, and on failure emits an actionable alert and/or
# opens a follow-up issue (via a configurable webhook or the gh CLI).
#
# It NEVER touches the live database. All work happens inside a throwaway
# database (and, when configured, a throwaway container) that is destroyed
# on exit.
#
# Usage:
#   scripts/ops/restore-test.sh [--env production|staging] [--backup PATH]
#                               [--dry-run] [--help]
#
# Environment variables (all optional unless noted):
#   RESTORE_TEST_ENV            Default environment: production|staging (default: staging)
#   RESTORE_TEST_BACKUP_DIR     Directory containing backups (default: ./backups)
#   RESTORE_TEST_BACKUP_FILE    Explicit backup file to restore (overrides discovery)
#   RESTORE_TEST_BACKUP_GLOB    Glob used to discover the latest backup
#                               (default: "<env>-*.dump")
#   RESTORE_TEST_ISOLATED_DB    Name of the throwaway database (default: restore_test_<env>_<ts>)
#   RESTORE_TEST_ISOLATED_HOST  Host for the isolated DB (default: 127.0.0.1)
#   RESTORE_TEST_ISOLATED_PORT  Port for the isolated DB (default: 5432)
#   RESTORE_TEST_ISOLATED_USER  User for the isolated DB (default: postgres)
#   RESTORE_TEST_ISOLATED_PASS  Password for the isolated DB (default: empty)
#   RESTORE_TEST_EXPECTED_FILE  JSON file with expected counts/integrity checks
#                               (default: scripts/ops/restore-test.expected.json)
#   RESTORE_TEST_WEBHOOK_URL    Webhook URL to POST failure alerts to
#   RESTORE_TEST_GH_REPO        "owner/repo" for gh CLI issue creation
#   RESTORE_TEST_GH_LABELS      Comma-separated labels for the issue (default: operations,reliability)
#   RESTORE_TEST_GH_ASSIGNEE    Optional assignee for the issue
#   RESTORE_TEST_ALERT_ONLY     If "1", never open issues, only alert
#   RESTORE_TEST_TIMEOUT        Per-command timeout in seconds (default: 600)
#   RESTORE_TEST_LOG_DIR        Directory for logs (default: ./logs/restore-tests)
#
# Exit codes:
#   0  restore test passed
#   1  restore test failed (verification or restore error)
#   2  usage / configuration error
#   3  environment could not be provisioned
#
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
RESTORE_TEST_ENV="${RESTORE_TEST_ENV:-staging}"
RESTORE_TEST_BACKUP_DIR="${RESTORE_TEST_BACKUP_DIR:-${REPO_ROOT}/backups}"
RESTORE_TEST_BACKUP_FILE="${RESTORE_TEST_BACKUP_FILE:-}"
RESTORE_TEST_BACKUP_GLOB="${RESTORE_TEST_BACKUP_GLOB:-}"
RESTORE_TEST_ISOLATED_DB="${RESTORE_TEST_ISOLATED_DB:-}"
RESTORE_TEST_ISOLATED_HOST="${RESTORE_TEST_ISOLATED_HOST:-127.0.0.1}"
RESTORE_TEST_ISOLATED_PORT="${RESTORE_TEST_ISOLATED_PORT:-5432}"
RESTORE_TEST_ISOLATED_USER="${RESTORE_TEST_ISOLATED_USER:-postgres}"
RESTORE_TEST_ISOLATED_PASS="${RESTORE_TEST_ISOLATED_PASS:-}"
RESTORE_TEST_EXPECTED_FILE="${RESTORE_TEST_EXPECTED_FILE:-${SCRIPT_DIR}/restore-test.expected.json}"
RESTORE_TEST_WEBHOOK_URL="${RESTORE_TEST_WEBHOOK_URL:-}"
RESTORE_TEST_GH_REPO="${RESTORE_TEST_GH_REPO:-}"
RESTORE_TEST_GH_LABELS="${RESTORE_TEST_GH_LABELS:-operations,reliability}"
RESTORE_TEST_GH_ASSIGNEE="${RESTORE_TEST_GH_ASSIGNEE:-}"
RESTORE_TEST_ALERT_ONLY="${RESTORE_TEST_ALERT_ONLY:-0}"
RESTORE_TEST_TIMEOUT="${RESTORE_TEST_TIMEOUT:-600}"
RESTORE_TEST_LOG_DIR="${RESTORE_TEST_LOG_DIR:-${REPO_ROOT}/logs/restore-tests}"

DRY_RUN=0
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="restore-test-${TIMESTAMP}-$$"
LOG_FILE=""
ISOLATED_DB=""
ISOLATED_DB_CREATED=0
FAILURES=()
CHECKS_RUN=0
CHECKS_PASSED=0

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log() {
  local level="$1"; shift
  local msg="$*"
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [${level}] ${msg}"
  printf '%s\n' "${line}" >&2
  if [[ -n "${LOG_FILE}" ]]; then
    printf '%s\n' "${line}" >>"${LOG_FILE}"
  fi
}

info()  { log INFO  "$@"; }
warn()  { log WARN  "$@"; }
error() { log ERROR "$@"; }

usage() {
  sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env)
        [[ $# -ge 2 ]] || { error "--env requires a value"; exit 2; }
        RESTORE_TEST_ENV="$2"; shift 2 ;;
      --backup)
        [[ $# -ge 2 ]] || { error "--backup requires a value"; exit 2; }
        RESTORE_TEST_BACKUP_FILE="$2"; shift 2 ;;
      --dry-run)
        DRY_RUN=1; shift ;;
      --help|-h)
        usage ;;
      *)
        error "Unknown argument: $1"
        exit 2 ;;
    esac
  done

  case "${RESTORE_TEST_ENV}" in
    production|staging) ;;
    *)
      error "Invalid environment '${RESTORE_TEST_ENV}' (expected production|staging)"
      exit 2 ;;
  esac
}

# ---------------------------------------------------------------------------
# Cleanup / trap handling
# ---------------------------------------------------------------------------
cleanup() {
  local rc=$?
  if [[ "${ISOLATED_DB_CREATED}" -eq 1 && -n "${ISOLATED_DB}" ]]; then
    info "Dropping isolated database '${ISOLATED_DB}'"
    if ! run_psql_admin -c "DROP DATABASE IF EXISTS \"${ISOLATED_DB}\";" >/dev/null 2>&1; then
      warn "Failed to drop isolated database '${ISOLATED_DB}' (manual cleanup may be required)"
    fi
  fi
  if [[ -n "${LOG_FILE}" ]]; then
    info "Log written to ${LOG_FILE}"
  fi
  exit "${rc}"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Safety guards
# ---------------------------------------------------------------------------
assert_isolated_target() {
  # Refuse to run against anything that looks like a live/production host.
  local host_lc
  host_lc="$(printf '%s' "${RESTORE_TEST_ISOLATED_HOST}" | tr '[:upper:]' '[:lower:]')"

  if [[ "${host_lc}" == *prod* || "${host_lc}" == *live* ]]; then
    error "Refusing to run: isolated host '${RESTORE_TEST_ISOLATED_HOST}' looks like a live/production host"
    exit 3
  fi

  # The isolated database name must be clearly a throwaway.
  if [[ -z "${ISOLATED_DB}" ]]; then
    error "Isolated database name is empty"
    exit 3
  fi
  if [[ "${ISOLATED_DB}" != restore_test_* ]]; then
    error "Refusing to run: isolated database '${ISOLATED_DB}' must start with 'restore_test_'"
    exit 3
  fi
}

# ---------------------------------------------------------------------------
# Command wrappers
# ---------------------------------------------------------------------------
run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${RESTORE_TEST_TIMEOUT}" "$@"
  else
    "$@"
  fi
}

psql_env() {
  export PGPASSWORD="${RESTORE_TEST_ISOLATED_PASS}"
  export PGCONNECT_TIMEOUT=15
}

run_psql_admin() {
  psql_env
  run_with_timeout psql \
    --host "${RESTORE_TEST_ISOLATED_HOST}" \
    --port "${RESTORE_TEST_ISOLATED_PORT}" \
    --username "${RESTORE_TEST_ISOLATED_USER}" \
    --dbname postgres \
    --no-psqlrc \
    --quiet \
    --tuples-only \
    --no-align \
    "$@"
}

run_psql_isolated() {
  psql_env
  run_with_timeout psql \
    --host "${RESTORE_TEST_ISOLATED_HOST}" \
    --port "${RESTORE_TEST_ISOLATED_PORT}" \
    --username "${RESTORE_TEST_ISOLATED_USER}" \
    --dbname "${ISOLATED_DB}" \
    --no-psqlrc \
    --quiet \
    --tuples-only \
    --no-align \
    "$@"
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
check_dependencies() {
  local missing=0
  for bin in psql pg_restore; do
    if ! command -v "${bin}" >/dev/null 2>&1; then
      error "Required dependency '${bin}' not found in PATH"
      missing=1
    fi
  done
  if [[ "${missing}" -ne 0 ]]; then
    exit 3
  fi
  if [[ -n "${RESTORE_TEST_EXPECTED_FILE}" && ! -f "${RESTORE_TEST_EXPECTED_FILE}" ]]; then
    error "Expected-values file not found: ${RESTORE_TEST_EXPECTED_FILE}"
    exit 2
  fi
  if ! command -v jq >/dev/null 2>&1; then
    error "Required dependency 'jq' not found in PATH"
    exit 3
  fi
}

# ---------------------------------------------------------------------------
# Backup discovery
# ---------------------------------------------------------------------------
discover_backup() {
  if [[ -n "${RESTORE_TEST_BACKUP_FILE}" ]]; then
    if [[ ! -f "${RESTORE_TEST_BACKUP_FILE}" ]]; then
      error "Specified backup file not found: ${RESTORE_TEST_BACKUP_FILE}"
      exit 2
    fi
    info "Using explicitly specified backup: ${RESTORE_TEST_BACKUP_FILE}"
    return 0
  fi

  local glob="${RESTORE_TEST_BACKUP_GLOB}"
  if [[ -z "${glob}" ]]; then
    glob="${RESTORE_TEST_ENV}-*.dump"
  fi

  if [[ ! -d "${RESTORE_TEST_BACKUP_DIR}" ]]; then
    error "Backup directory not found: ${RESTORE_TEST_BACKUP_DIR}"
    exit 2
  fi

  local latest
  latest="$(find "${RESTORE_TEST_BACKUP_DIR}" -maxdepth 1 -type f -name "${glob}" -printf '%T@ %p\n' 2>/dev/null \
    | sort -n | tail -n 1 | awk '{print $2}')"

  if [[ -z "${latest}" ]]; then
    error "No backup matching '${glob}' found in ${RESTORE_TEST_BACKUP_DIR}"
    exit 2
  fi

  RESTORE_TEST_BACKUP_FILE="${latest}"
  info "Discovered latest backup: ${RESTORE_TEST_BACKUP_FILE}"
}

# ---------------------------------------------------------------------------
# Isolated environment provisioning
# ---------------------------------------------------------------------------
provision_isolated_env() {
  if [[ -z "${RESTORE_TEST_ISOLATED_DB}" ]]; then
    ISOLATED_DB="restore_test_${RESTORE_TEST_ENV}_$(date -u +%Y%m%d%H%M%S)_$$"
  else
    ISOLATED_DB="${RESTORE_TEST_ISOLATED_DB}"
  fi

  assert_isolated_target

  info "Provisioning isolated restore database '${ISOLATED_DB}' on ${RESTORE_TEST_ISOLATED_HOST}:${RESTORE_TEST_ISOLATED_PORT}"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] Would create database '${ISOLATED_DB}'"
    return 0
  fi

  if ! run_psql_admin -c "SELECT 1;" >/dev/null 2>&1; then
    error "Cannot connect to isolated database server at ${RESTORE_TEST_ISOLATED_HOST}:${RESTORE_TEST_ISOLATED_PORT}"
    exit 3
  fi

  # Ensure no pre-existing database with this name (defensive).
  run_psql_admin -c "DROP DATABASE IF EXISTS \"${ISOLATED_DB}\";" >/dev/null 2>&1 || true

  if ! run_psql_admin -c "CREATE DATABASE \"${ISOLATED_DB}\";" >/dev/null; then
    error "Failed to create isolated database '${ISOLATED_DB}'"
    exit 3
  fi
  ISOLATED_DB_CREATED=1
  info "Isolated database '${ISOLATED_DB}' created"
}

# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------
restore_backup() {
  info "Restoring '${RESTORE_TEST_BACKUP_FILE}' into '${ISOLATED_DB}'"

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] Would run pg_restore into '${ISOLATED_DB}'"
    return 0
  fi

  psql_env
  local restore_log="${LOG_FILE}.pg_restore.log"
  set +e
  run_with_timeout pg_restore \
    --host "${RESTORE_TEST_ISOLATED_HOST}" \
    --port "${RESTORE_TEST_ISOLATED_PORT}" \
    --username "${RESTORE_TEST_ISOLATED_USER}" \
    --dbname "${ISOLATED_DB}" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    --verbose \
    "${RESTORE_TEST_BACKUP_FILE}" >"${restore_log}" 2>&1
  local rc=$?
  set -e

  if [[ "${rc}" -ne 0 ]]; then
    error "pg_restore failed with exit code ${rc} (see ${restore_log})"
    FAILURES+=("pg_restore failed with exit code ${rc}")
    return 1
  fi
  info "Restore completed successfully"
  return 0
}

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
record_failure() {
  FAILURES+=("$1")
  error "CHECK FAILED: $1"
}

verify_counts() {
  local table expected actual
  local count
  count="$(jq '.counts // {} | length' "${RESTORE_TEST_EXPECTED_FILE}")"
  if [[ "${count}" -eq 0 ]]; then
    warn "No count checks defined in ${RESTORE_TEST_EXPECTED_FILE}"
    return 0
  fi

  while IFS=$'\t' read -r table expected; do
    [[ -z "${table}" ]] && continue
    CHECKS_RUN=$((CHECKS_RUN + 1))
    actual="$(run_psql_isolated -c "SELECT count(*) FROM \"${table}\";" 2>/dev/null | tr -d '[:space:]')" || actual=""
    if [[ -z "${actual}" ]]; then
      record_failure "count(${table}): could not query table"
      continue
    fi
    if [[ "${actual}" -lt "${expected}" ]]; then
      record_failure "count(${table}): expected >= ${expected}, got ${actual}"
    else
      CHECKS_PASSED=$((CHECKS_PASSED + 1))
      info "count(${table}): ${actual} (>= ${expected}) OK"
    fi
  done < <(jq -r '.counts // {} | to_entries[] | "\(.key)\t\(.value)"' "${RESTORE_TEST_EXPECTED_FILE}")
}

verify_integrity() {
  local name sql expected actual
  local count
  count="$(jq '.integrity // [] | length' "${RESTORE_TEST_EXPECTED_FILE}")"
  if [[ "${count}" -eq 0 ]]; then
    warn "No integrity checks defined in ${RESTORE_TEST_EXPECTED_FILE}"
    return 0
  fi

  local i=0
  while [[ "${i}" -lt "${count}" ]]; do
    name="$(jq -r ".integrity[${i}].name // \"check_${i}\"" "${RESTORE_TEST_EXPECTED_FILE}")"
    sql="$(jq -r ".integrity[${i}].sql // empty" "${RESTORE_TEST_EXPECTED_FILE}")"
    expected="$(jq -r ".integrity[${i}].expected // empty" "${RESTORE_TEST_EXPECTED_FILE}")"
    i=$((i + 1))

    if [[ -z "${sql}" ]]; then
      warn "Integrity check '${name}' has no SQL; skipping"
      continue
    fi

    CHECKS_RUN=$((CHECKS_RUN + 1))
    actual="$(run_psql_isolated -c "${sql}" 2>/dev/null | tr -d '[:space:]')" || actual=""
    if [[ -z "${actual}" ]]; then
      record_failure "integrity(${name}): query failed"
      continue
    fi

    if [[ -n "${expected}" && "${actual}" != "${expected}" ]]; then
      record_failure "integrity(${name}): expected '${expected}', got '${actual}'"
    else
      CHECKS_PASSED=$((CHECKS_PASSED + 1))
      info "integrity(${name}): ${actual} OK"
    fi
  done
}

verify_restore() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] Would run verification checks"
    return 0
  fi

  info "Running verification checks"
  verify_counts
  verify_integrity

  info "Verification summary: ${CHECKS_PASSED}/${CHECKS_RUN} checks passed"

  if [[ "${#FAILURES[@]}" -gt 0 ]]; then
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Failure reporting
# ---------------------------------------------------------------------------
build_failure_summary() {
  local summary
  summary="Restore test FAILED for environment '${RESTORE_TEST_ENV}' (run ${RUN_ID})."$'\n'
  summary+="Backup: ${RESTORE_TEST_BACKUP_FILE}"$'\n'
  summary+="Checks: ${CHECKS_PASSED}/${CHECKS_RUN} passed"$'\n'
  summary+="Failures:"$'\n'
  local f
  for f in "${FAILURES[@]}"; do
    summary+="  - ${f}"$'\n'
  done
  summary+="Log: ${LOG_FILE}"$'\n'
  summary+="Follow-up: investigate the backup/restore pipeline, verify backup integrity, and re-run scripts/ops/restore-test.sh."
  printf '%s' "${summary}"
}

send_webhook_alert() {
  local summary="$1"
  if [[ -z "${RESTORE_TEST_WEBHOOK_URL}" ]]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not available; cannot send webhook alert"
    return 0
  fi

  local payload
  payload="$(jq -n \
    --arg text "${summary}" \
    --arg env "${RESTORE_TEST_ENV}" \
    --arg run "${RUN_ID}" \
    --arg backup "${RESTORE_TEST_BACKUP_FILE}" \
    '{text: $text, environment: $env, run_id: $run, backup: $backup}')"

  info "Sending failure alert to webhook"
  if ! curl --silent --show-error --fail \
      --max-time 30 \
      -H "Content-Type: application/json" \
      -X POST \
      --data "${payload}" \
      "${RESTORE_TEST_WEBHOOK_URL}" >/dev/null; then
    warn "Failed to deliver webhook alert"
  fi
}

open_followup_issue() {
  local summary="$1"
  if [[ "${RESTORE_TEST_ALERT_ONLY}" == "1" ]]; then
    info "RESTORE_TEST_ALERT_ONLY=1; skipping issue creation"
    return 0
  fi
  if [[ -z "${RESTORE_TEST_GH_REPO}" ]]; then
    info "RESTORE_TEST_GH_REPO not set; skipping issue creation"
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    warn "gh CLI not available; cannot open follow-up issue"
    return 0
  fi

  local title="Restore test failed: ${RESTORE_TEST_ENV} (${TIMESTAMP})"
  local body
  body="$(printf '## Automated restore test failure\n\n```\n%s\n```\n\n### Action items\n- [ ] Inspect the backup artifact and restore logs\n- [ ] Confirm the backup pipeline is healthy\n- [ ] Re-run `scripts/ops/restore-test.sh --env %s`\n' "${summary}" "${RESTORE_TEST_ENV}")"

  local args=(issue create --repo "${RESTORE_TEST_GH_REPO}" --title "${title}" --body "${body}")
  if [[ -n "${RESTORE_TEST_GH_LABELS}" ]]; then
    args+=(--label "${RESTORE_TEST_GH_LABELS}")
  fi
  if [[ -n "${RESTORE_TEST_GH_ASSIGNEE}" ]]; then
    args+=(--assignee "${RESTORE_TEST_GH_ASSIGNEE}")
  fi

  info "Opening follow-up issue in ${RESTORE_TEST_GH_REPO}"
  if ! gh "${args[@]}" >/dev/null 2>&1; then
    warn "Failed to open follow-up issue via gh CLI"
  fi
}

report_failure() {
  local summary
  summary="$(build_failure_summary)"
  error "${summary}"
  send_webhook_alert "${summary}"
  open_followup_issue "${summary}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"

  mkdir -p "${RESTORE_TEST_LOG_DIR}"
  LOG_FILE="${RESTORE_TEST_LOG_DIR}/${RUN_ID}.log"
  : >"${LOG_FILE}"

  info "Starting restore test (run ${RUN_ID})"
  info "Environment: ${RESTORE_TEST_ENV}"
  info "Dry run: ${DRY_RUN}"

  check_dependencies
  discover_backup
  provision_isolated_env

  local restore_ok=1
  if ! restore_backup; then
    restore_ok=0
  fi

  local verify_ok=1
  if [[ "${restore_ok}" -eq 1 ]]; then
    if ! verify_restore; then
      verify_ok=0
    fi
  else
    verify_ok=0
  fi

  if [[ "${restore_ok}" -eq 1 && "${verify_ok}" -eq 1 ]]; then
    info "Restore test PASSED (${CHECKS_PASSED}/${CHECKS_RUN} checks)"
    exit 0
  fi

  report_failure
  error "Restore test FAILED"
  exit 1
}

main "$@"