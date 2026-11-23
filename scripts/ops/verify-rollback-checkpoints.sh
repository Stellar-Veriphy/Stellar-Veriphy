#!/usr/bin/env bash
#
# verify-rollback-checkpoints.sh
#
# Read-only verification of application and contract rollback checkpoints.
#
# This script identifies the current and previous application/contract
# versions and their associated artifacts, then performs health checks on
# each rollback point:
#   - container health via scripts/check-container-health.sh
#   - contract state snapshot comparison via scripts/snapshot-contract-state.sh
#   - provenance recovery dry-run via scripts/provenance-recovery.mjs
#
# It exits non-zero when any rollback point is unhealthy so that promotion
# is blocked. The script MUST NOT modify live data; all checks are read-only
# or dry-run only.
#
# Usage:
#   scripts/ops/verify-rollback-checkpoints.sh [options]
#
# Options:
#   -e, --env <name>          Deployment environment (default: $DEPLOY_ENV or "production")
#   -a, --app <name>          Application name (default: $APP_NAME or "app")
#   -c, --contract <name>     Contract name (default: $CONTRACT_NAME or "contract")
#   -r, --repo-root <path>    Repository root (default: git root or script's ../..)
#   -o, --output-dir <path>   Directory for read-only verification artifacts
#                             (default: a fresh mktemp dir)
#       --app-current <ref>   Override current application version/ref
#       --app-previous <ref>  Override previous application version/ref
#       --contract-current <ref>   Override current contract version/ref
#       --contract-previous <ref>  Override previous contract version/ref
#       --skip-app            Skip application rollback checks
#       --skip-contract       Skip contract rollback checks
#       --dry-run             Print planned checks without executing them
#   -h, --help                Show this help
#
# Exit codes:
#   0  All rollback checkpoints healthy
#   1  One or more rollback checkpoints unhealthy (promotion blocked)
#   2  Usage / configuration error
#   3  Required tooling or scripts missing
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults & global state
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEPLOY_ENV="${DEPLOY_ENV:-production}"
APP_NAME="${APP_NAME:-app}"
CONTRACT_NAME="${CONTRACT_NAME:-contract}"
REPO_ROOT=""
OUTPUT_DIR=""
APP_CURRENT=""
APP_PREVIOUS=""
CONTRACT_CURRENT=""
CONTRACT_PREVIOUS=""
SKIP_APP=0
SKIP_CONTRACT=0
DRY_RUN=0

# Collected results: each entry is "STATUS|CHECKPOINT|DETAIL"
declare -a RESULTS=()
UNHEALTHY_COUNT=0

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log()   { printf '[verify-rollback] %s\n' "$*" >&2; }
info()  { printf '[verify-rollback] INFO: %s\n' "$*" >&2; }
warn()  { printf '[verify-rollback] WARN: %s\n' "$*" >&2; }
error() { printf '[verify-rollback] ERROR: %s\n' "$*" >&2; }

usage() {
  sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

record_result() {
  local status="$1" checkpoint="$2" detail="$3"
  RESULTS+=("${status}|${checkpoint}|${detail}")
  if [[ "${status}" != "HEALTHY" && "${status}" != "SKIPPED" ]]; then
    UNHEALTHY_COUNT=$((UNHEALTHY_COUNT + 1))
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -e|--env)                DEPLOY_ENV="${2:?missing value for $1}"; shift 2 ;;
      -a|--app)                APP_NAME="${2:?missing value for $1}"; shift 2 ;;
      -c|--contract)           CONTRACT_NAME="${2:?missing value for $1}"; shift 2 ;;
      -r|--repo-root)          REPO_ROOT="${2:?missing value for $1}"; shift 2 ;;
      -o|--output-dir)         OUTPUT_DIR="${2:?missing value for $1}"; shift 2 ;;
      --app-current)           APP_CURRENT="${2:?missing value for $1}"; shift 2 ;;
      --app-previous)          APP_PREVIOUS="${2:?missing value for $1}"; shift 2 ;;
      --contract-current)      CONTRACT_CURRENT="${2:?missing value for $1}"; shift 2 ;;
      --contract-previous)     CONTRACT_PREVIOUS="${2:?missing value for $1}"; shift 2 ;;
      --skip-app)              SKIP_APP=1; shift ;;
      --skip-contract)         SKIP_CONTRACT=1; shift ;;
      --dry-run)               DRY_RUN=1; shift ;;
      -h|--help)               usage; exit 0 ;;
      *) error "Unknown argument: $1"; usage; exit 2 ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Environment resolution
# ---------------------------------------------------------------------------
resolve_repo_root() {
  if [[ -n "${REPO_ROOT}" ]]; then
    return
  fi
  if REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null)"; then
    return
  fi
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
}

resolve_output_dir() {
  if [[ -z "${OUTPUT_DIR}" ]]; then
    OUTPUT_DIR="$(mktemp -d -t verify-rollback.XXXXXX)"
    info "Using temporary output directory: ${OUTPUT_DIR}"
  else
    mkdir -p "${OUTPUT_DIR}"
  fi
}

require_file() {
  local path="$1" label="$2"
  if [[ ! -f "${path}" ]]; then
    error "Missing ${label}: ${path}"
    exit 3
  fi
}

# ---------------------------------------------------------------------------
# Version / artifact identification (read-only)
# ---------------------------------------------------------------------------
# Resolve a version reference for a component. Prefers an explicit override,
# then a version file, then git describe. Never writes anything.
resolve_version() {
  local component="$1" override="$2"
  if [[ -n "${override}" ]]; then
    printf '%s' "${override}"
    return
  fi

  local candidates=(
    "${REPO_ROOT}/deploy/${component}/VERSION"
    "${REPO_ROOT}/deploy/${component}/version.txt"
    "${REPO_ROOT}/${component}/VERSION"
  )
  local f
  for f in "${candidates[@]}"; do
    if [[ -f "${f}" ]]; then
      head -n1 "${f}" | tr -d '[:space:]'
      return
    fi
  done

  if git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "${REPO_ROOT}" describe --tags --always --dirty 2>/dev/null || echo "unknown"
    return
  fi

  echo "unknown"
}

# Locate the artifact (image tag / build artifact / contract bundle) for a
# given component and version. Read-only: only inspects filesystem / metadata.
resolve_artifact() {
  local component="$1" version="$2"
  local candidates=(
    "${REPO_ROOT}/deploy/${component}/artifacts/${version}"
    "${REPO_ROOT}/artifacts/${component}/${version}"
    "${REPO_ROOT}/dist/${component}/${version}"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -e "${c}" ]]; then
      printf '%s' "${c}"
      return
    fi
  done
  printf '%s' "not-found"
}

identify_checkpoints() {
  info "Identifying rollback checkpoints for environment '${DEPLOY_ENV}'"

  if [[ "${SKIP_APP}" -eq 0 ]]; then
    APP_CURRENT="$(resolve_version "${APP_NAME}" "${APP_CURRENT}")"
    APP_PREVIOUS="$(resolve_version "${APP_NAME}" "${APP_PREVIOUS}")"
    APP_CURRENT_ARTIFACT="$(resolve_artifact "${APP_NAME}" "${APP_CURRENT}")"
    APP_PREVIOUS_ARTIFACT="$(resolve_artifact "${APP_NAME}" "${APP_PREVIOUS}")"
    info "Application '${APP_NAME}': current=${APP_CURRENT} (${APP_CURRENT_ARTIFACT}) previous=${APP_PREVIOUS} (${APP_PREVIOUS_ARTIFACT})"
  fi

  if [[ "${SKIP_CONTRACT}" -eq 0 ]]; then
    CONTRACT_CURRENT="$(resolve_version "${CONTRACT_NAME}" "${CONTRACT_CURRENT}")"
    CONTRACT_PREVIOUS="$(resolve_version "${CONTRACT_NAME}" "${CONTRACT_PREVIOUS}")"
    CONTRACT_CURRENT_ARTIFACT="$(resolve_artifact "${CONTRACT_NAME}" "${CONTRACT_CURRENT}")"
    CONTRACT_PREVIOUS_ARTIFACT="$(resolve_artifact "${CONTRACT_NAME}" "${CONTRACT_PREVIOUS}")"
    info "Contract '${CONTRACT_NAME}': current=${CONTRACT_CURRENT} (${CONTRACT_CURRENT_ARTIFACT}) previous=${CONTRACT_PREVIOUS} (${CONTRACT_PREVIOUS_ARTIFACT})"
  fi
}

# ---------------------------------------------------------------------------
# Health checks (read-only)
# ---------------------------------------------------------------------------
run_container_health() {
  local component="$1" version="$2" artifact="$3"
  local checkpoint="${component}@${version}"
  local health_script="${REPO_ROOT}/scripts/check-container-health.sh"

  if [[ "${artifact}" == "not-found" ]]; then
    record_result "UNHEALTHY" "${checkpoint}" "artifact not found"
    return
  fi

  if [[ ! -f "${health_script}" ]]; then
    record_result "UNHEALTHY" "${checkpoint}" "missing check-container-health.sh"
    return
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] would run: ${health_script} --component ${component} --version ${version} --artifact ${artifact}"
    record_result "HEALTHY" "${checkpoint}" "dry-run"
    return
  fi

  local out="${OUTPUT_DIR}/container-health-${component}-${version}.log"
  if bash "${health_script}" \
        --component "${component}" \
        --version "${version}" \
        --artifact "${artifact}" \
        >"${out}" 2>&1; then
    record_result "HEALTHY" "${checkpoint}" "container health OK"
  else
    local rc=$?
    record_result "UNHEALTHY" "${checkpoint}" "container health failed (rc=${rc}); see ${out}"
  fi
}

run_contract_snapshot() {
  local version="$1" artifact="$2"
  local checkpoint="${CONTRACT_NAME}@${version}"
  local snapshot_script="${REPO_ROOT}/scripts/snapshot-contract-state.sh"

  if [[ "${artifact}" == "not-found" ]]; then
    record_result "UNHEALTHY" "${checkpoint}" "contract artifact not found"
    return
  fi

  if [[ ! -f "${snapshot_script}" ]]; then
    record_result "UNHEALTHY" "${checkpoint}" "missing snapshot-contract-state.sh"
    return
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] would run: ${snapshot_script} --contract ${CONTRACT_NAME} --version ${version} --artifact ${artifact} --compare"
    record_result "HEALTHY" "${checkpoint}" "dry-run"
    return
  fi

  local out="${OUTPUT_DIR}/contract-snapshot-${version}.log"
  if bash "${snapshot_script}" \
        --contract "${CONTRACT_NAME}" \
        --version "${version}" \
        --artifact "${artifact}" \
        --compare \
        >"${out}" 2>&1; then
    record_result "HEALTHY" "${checkpoint}" "contract state snapshot matches"
  else
    local rc=$?
    record_result "UNHEALTHY" "${checkpoint}" "contract state snapshot mismatch (rc=${rc}); see ${out}"
  fi
}

run_provenance_dry_run() {
  local component="$1" version="$2" artifact="$3"
  local checkpoint="${component}@${version} (provenance)"
  local recovery_script="${REPO_ROOT}/scripts/provenance-recovery.mjs"

  if [[ ! -f "${recovery_script}" ]]; then
    record_result "UNHEALTHY" "${checkpoint}" "missing provenance-recovery.mjs"
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    record_result "UNHEALTHY" "${checkpoint}" "node not available"
    return
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] would run: node ${recovery_script} --component ${component} --version ${version} --artifact ${artifact} --dry-run"
    record_result "HEALTHY" "${checkpoint}" "dry-run"
    return
  fi

  local out="${OUTPUT_DIR}/provenance-${component}-${version}.log"
  if node "${recovery_script}" \
        --component "${component}" \
        --version "${version}" \
        --artifact "${artifact}" \
        --dry-run \
        >"${out}" 2>&1; then
    record_result "HEALTHY" "${checkpoint}" "provenance recovery dry-run OK"
  else
    local rc=$?
    record_result "UNHEALTHY" "${checkpoint}" "provenance recovery dry-run failed (rc=${rc}); see ${out}"
  fi
}

verify_application() {
  info "Verifying application rollback checkpoints"
  local version artifact
  for pair in "current:${APP_CURRENT}:${APP_CURRENT_ARTIFACT}" \
              "previous:${APP_PREVIOUS}:${APP_PREVIOUS_ARTIFACT}"; do
    IFS=':' read -r _ version artifact <<<"${pair}"
    run_container_health "${APP_NAME}" "${version}" "${artifact}"
    run_provenance_dry_run "${APP_NAME}" "${version}" "${artifact}"
  done
}

verify_contract() {
  info "Verifying contract rollback checkpoints"
  local version artifact
  for pair in "current:${CONTRACT_CURRENT}:${CONTRACT_CURRENT_ARTIFACT}" \
              "previous:${CONTRACT_PREVIOUS}:${CONTRACT_PREVIOUS_ARTIFACT}"; do
    IFS=':' read -r _ version artifact <<<"${pair}"
    run_contract_snapshot "${version}" "${artifact}"
    run_provenance_dry_run "${CONTRACT_NAME}" "${version}" "${artifact}"
  done
}

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
write_report() {
  local report="${OUTPUT_DIR}/rollback-verification-report.txt"
  {
    echo "Rollback checkpoint verification report"
    echo "Environment: ${DEPLOY_ENV}"
    echo "Generated:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Repo root:   ${REPO_ROOT}"
    echo "Dry run:     ${DRY_RUN}"
    echo
    echo "Checkpoints:"
    if [[ "${SKIP_APP}" -eq 0 ]]; then
      echo "  app current:    ${APP_NAME}@${APP_CURRENT} (${APP_CURRENT_ARTIFACT})"
      echo "  app previous:   ${APP_NAME}@${APP_PREVIOUS} (${APP_PREVIOUS_ARTIFACT})"
    fi
    if [[ "${SKIP_CONTRACT}" -eq 0 ]]; then
      echo "  contract current:  ${CONTRACT_NAME}@${CONTRACT_CURRENT} (${CONTRACT_CURRENT_ARTIFACT})"
      echo "  contract previous: ${CONTRACT_NAME}@${CONTRACT_PREVIOUS} (${CONTRACT_PREVIOUS_ARTIFACT})"
    fi
    echo
    echo "Results:"
    local r
    for r in "${RESULTS[@]}"; do
      IFS='|' read -r status checkpoint detail <<<"${r}"
      printf '  [%-9s] %-40s %s\n' "${status}" "${checkpoint}" "${detail}"
    done
    echo
    if [[ "${UNHEALTHY_COUNT}" -eq 0 ]]; then
      echo "Overall: HEALTHY (promotion allowed)"
    else
      echo "Overall: UNHEALTHY (${UNHEALTHY_COUNT} unhealthy checkpoint(s); promotion BLOCKED)"
    fi
  } >"${report}"
  info "Report written to ${report}"
}

print_summary() {
  echo
  echo "=== Rollback Checkpoint Verification Summary ==="
  local r
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r status checkpoint detail <<<"${r}"
    printf '  [%-9s] %-40s %s\n' "${status}" "${checkpoint}" "${detail}"
  done
  echo
  if [[ "${UNHEALTHY_COUNT}" -eq 0 ]]; then
    echo "Result: HEALTHY — promotion allowed."
  else
    echo "Result: UNHEALTHY — ${UNHEALTHY_COUNT} unhealthy checkpoint(s). Promotion BLOCKED."
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"
  resolve_repo_root
  resolve_output_dir

  info "Repo root: ${REPO_ROOT}"
  info "Output dir: ${OUTPUT_DIR}"

  identify_checkpoints

  if [[ "${SKIP_APP}" -eq 0 ]]; then
    verify_application
  else
    record_result "SKIPPED" "application" "skipped via --skip-app"
  fi

  if [[ "${SKIP_CONTRACT}" -eq 0 ]]; then
    verify_contract
  else
    record_result "SKIPPED" "contract" "skipped via --skip-contract"
  fi

  write_report
  print_summary

  if [[ "${UNHEALTHY_COUNT}" -gt 0 ]]; then
    error "Rollback verification failed; blocking promotion."
    exit 1
  fi

  info "All rollback checkpoints healthy."
  exit 0
}

main "$@"