#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# bootstrap.sh — First-Launch LLM Hydration Pipeline
#
# Detects local hardware, downloads the quantized code-generation model if
# missing, and launches the llama.cpp sidecar server with the optimal
# acceleration flags.  Designed to be invoked once at first launch and
# idempotently on every subsequent start.
#
# Usage:
#   ./bootstrap.sh              # auto-detect everything, download if needed, launch
#   ./bootstrap.sh --detect     # print hardware profile and exit
#   ./bootstrap.sh --download   # download model only, do not launch server
#   ./bootstrap.sh --serve      # launch server only (model must already exist)
#   ./bootstrap.sh --status     # check if the sidecar is already running
#   ./bootstrap.sh --kill       # terminate a running sidecar
#
# Environment overrides:
#   AIDE_MODEL_REPO    — Hugging Face repo  (default: Qwen/Qwen2.5-Coder-7B-Instruct-GGUF)
#   AIDE_MODEL_FILE    — GGUF filename      (default: qwen2.5-coder-7b-instruct-q4_k_m.gguf)
#   AIDE_BIND_HOST     — Server bind host   (default: 127.0.0.1)
#   AIDE_BIND_PORT     — Server bind port   (default: 8080)
#   AIDE_CTX_SIZE      — Context window      (default: 8192)
#   AIDE_GPU_LAYERS    — GPU offload layers  (default: auto)
#   AIDE_THREADS       — CPU thread count    (default: auto)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/bin"
CACHE_DIR="${SCRIPT_DIR}/cache"
RULES_FILE="${SCRIPT_DIR}/sampling_rules.json"
PID_FILE="${CACHE_DIR}/.sidecar.pid"
LOG_FILE="${CACHE_DIR}/sidecar.log"

# ── Defaults (overridable via environment) ───────────────────────────────────

MODEL_REPO="${AIDE_MODEL_REPO:-Qwen/Qwen2.5-Coder-7B-Instruct-GGUF}"
MODEL_FILE="${AIDE_MODEL_FILE:-qwen2.5-coder-7b-instruct-q4_k_m.gguf}"
MODEL_SHA256="${AIDE_MODEL_SHA256:-}"
BIND_HOST="${AIDE_BIND_HOST:-127.0.0.1}"
BIND_PORT="${AIDE_BIND_PORT:-8080}"
CTX_SIZE="${AIDE_CTX_SIZE:-8192}"
GPU_LAYERS="${AIDE_GPU_LAYERS:-auto}"
THREADS="${AIDE_THREADS:-auto}"

MODEL_PATH="${CACHE_DIR}/${MODEL_FILE}"
HF_CDN_BASE="https://huggingface.co/${MODEL_REPO}/resolve/main"
MODEL_URL="${HF_CDN_BASE}/${MODEL_FILE}"

# ── Terminal Output Helpers ──────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log_info()  { printf '%b[%s] [INFO]  %s%b\n' "${CYAN}"   "$(ts)" "$1" "${RESET}"; }
log_ok()    { printf '%b[%s] [OK]    %s%b\n' "${GREEN}"  "$(ts)" "$1" "${RESET}"; }
log_warn()  { printf '%b[%s] [WARN]  %s%b\n' "${YELLOW}" "$(ts)" "$1" "${RESET}"; }
log_err()   { printf '%b[%s] [ERROR] %s%b\n' "${RED}"    "$(ts)" "$1" "${RESET}" >&2; }
log_header(){ printf '\n%b══ %s ══%b\n\n' "${BOLD}" "$1" "${RESET}"; }

# ── Ensure directories exist ────────────────────────────────────────────────

mkdir -p "${BIN_DIR}" "${CACHE_DIR}"

# ═════════════════════════════════════════════════════════════════════════════
# 1. SYSTEM SNIFFING
# ═════════════════════════════════════════════════════════════════════════════

detect_os() {
    local uname_s
    uname_s="$(uname -s)"
    case "${uname_s}" in
        Darwin*)  echo "macos"   ;;
        Linux*)   echo "linux"   ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

detect_arch() {
    local uname_m
    uname_m="$(uname -m)"
    case "${uname_m}" in
        arm64|aarch64) echo "arm64"  ;;
        x86_64|amd64)  echo "x86_64" ;;
        *)             echo "${uname_m}" ;;
    esac
}

detect_physical_cores() {
    local os="$1"
    local cores=4  # safe fallback

    case "${os}" in
        macos)
            cores=$(sysctl -n hw.physicalcpu 2>/dev/null || echo 4)
            ;;
        linux)
            # Count unique physical core IDs, falling back to nproc
            if [ -f /proc/cpuinfo ]; then
                cores=$(grep -c "^processor" /proc/cpuinfo 2>/dev/null || echo 4)
                local physical
                physical=$(grep "^cpu cores" /proc/cpuinfo 2>/dev/null | head -1 | awk '{print $NF}')
                if [ -n "${physical}" ] && [ "${physical}" -gt 0 ] 2>/dev/null; then
                    local sockets
                    sockets=$(grep "^physical id" /proc/cpuinfo 2>/dev/null | sort -u | wc -l)
                    [ "${sockets}" -gt 0 ] && cores=$(( physical * sockets ))
                fi
            else
                cores=$(nproc 2>/dev/null || echo 4)
            fi
            ;;
        windows)
            cores=$(echo "${NUMBER_OF_PROCESSORS:-4}")
            ;;
    esac

    echo "${cores}"
}

detect_total_ram_gb() {
    local os="$1"
    local ram_gb=8  # safe fallback

    case "${os}" in
        macos)
            local bytes
            bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 8589934592)
            ram_gb=$(( bytes / 1073741824 ))
            ;;
        linux)
            if [ -f /proc/meminfo ]; then
                local kb
                kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
                [ -n "${kb}" ] && ram_gb=$(( kb / 1048576 ))
            fi
            ;;
    esac

    echo "${ram_gb}"
}

# ═════════════════════════════════════════════════════════════════════════════
# 2. HARDWARE ACCELERATION AUTO-MAPPING
# ═════════════════════════════════════════════════════════════════════════════

detect_acceleration() {
    local os="$1"
    local arch="$2"

    # ── Apple Silicon → Metal ──
    if [ "${os}" = "macos" ] && [ "${arch}" = "arm64" ]; then
        echo "metal"
        return 0
    fi

    # ── Nvidia GPU → CUDA ──
    if command -v nvidia-smi &>/dev/null; then
        local smi_out
        smi_out=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || true)
        if [ -n "${smi_out}" ]; then
            echo "cuda"
            return 0
        fi
    fi

    # ── AMD ROCm check (Linux) ──
    if [ "${os}" = "linux" ] && command -v rocm-smi &>/dev/null; then
        local rocm_out
        rocm_out=$(rocm-smi --showproductname 2>/dev/null || true)
        if [ -n "${rocm_out}" ]; then
            echo "rocm"
            return 0
        fi
    fi

    # ── Vulkan fallback check ──
    if command -v vulkaninfo &>/dev/null; then
        local vk_out
        vk_out=$(vulkaninfo --summary 2>/dev/null | grep -i "deviceName" || true)
        if [ -n "${vk_out}" ]; then
            echo "vulkan"
            return 0
        fi
    fi

    echo "cpu"
    return 0
}

compute_optimal_threads() {
    local physical_cores="$1"
    local accel="$2"

    if [ "${accel}" != "cpu" ]; then
        # When GPU is available, use fewer CPU threads to avoid contention
        local threads=$(( physical_cores / 2 ))
        [ "${threads}" -lt 2 ] && threads=2
        echo "${threads}"
        return 0
    fi

    # CPU-only: use 75% of cores, leave headroom to avoid thermal lockup
    local threads=$(( (physical_cores * 3) / 4 ))
    [ "${threads}" -lt 2 ] && threads=2
    echo "${threads}"
}

compute_gpu_layers() {
    local accel="$1"
    local ram_gb="$2"

    case "${accel}" in
        metal)
            # Apple Silicon shares unified memory — offload aggressively
            if [ "${ram_gb}" -ge 16 ]; then
                echo "99"  # offload all layers
            elif [ "${ram_gb}" -ge 8 ]; then
                echo "40"
            else
                echo "20"
            fi
            ;;
        cuda)
            # Check VRAM via nvidia-smi
            local vram_mb
            vram_mb=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo 0)
            vram_mb="${vram_mb//[[:space:]]/}"
            if ! [[ "${vram_mb}" =~ ^[0-9]+$ ]]; then
                vram_mb=0
            fi
            if [ "${vram_mb}" -ge 8000 ]; then
                echo "99"
            elif [ "${vram_mb}" -ge 6000 ]; then
                echo "35"
            elif [ "${vram_mb}" -ge 4000 ]; then
                echo "25"
            else
                echo "15"
            fi
            ;;
        rocm)
            echo "30"  # conservative for ROCm
            ;;
        vulkan)
            echo "20"  # conservative for Vulkan
            ;;
        cpu)
            echo "0"
            ;;
        *)
            echo "0"
            ;;
    esac
}

# ═════════════════════════════════════════════════════════════════════════════
# 3. HARDWARE PROFILE ASSEMBLY
# ═════════════════════════════════════════════════════════════════════════════

build_hardware_profile() {
    local os arch cores ram_gb accel opt_threads gpu_layers

    os="$(detect_os)"
    arch="$(detect_arch)"
    cores="$(detect_physical_cores "${os}")"
    ram_gb="$(detect_total_ram_gb "${os}")"
    accel="$(detect_acceleration "${os}" "${arch}")"

    if [ "${THREADS}" = "auto" ]; then
        opt_threads="$(compute_optimal_threads "${cores}" "${accel}")"
    else
        opt_threads="${THREADS}"
    fi

    if [ "${GPU_LAYERS}" = "auto" ]; then
        gpu_layers="$(compute_gpu_layers "${accel}" "${ram_gb}")"
    else
        gpu_layers="${GPU_LAYERS}"
    fi

    # Export for downstream use
    HW_OS="${os}"
    HW_ARCH="${arch}"
    HW_CORES="${cores}"
    HW_RAM_GB="${ram_gb}"
    HW_ACCEL="${accel}"
    HW_THREADS="${opt_threads}"
    HW_GPU_LAYERS="${gpu_layers}"
}

print_hardware_profile() {
    log_header "HARDWARE PROFILE"
    log_info "Operating System:    ${HW_OS}"
    log_info "Architecture:        ${HW_ARCH}"
    log_info "Physical CPU Cores:  ${HW_CORES}"
    log_info "System RAM:          ${HW_RAM_GB} GB"
    log_info "Acceleration:        ${HW_ACCEL}"
    log_info "Compute Threads:     ${HW_THREADS}"
    log_info "GPU Offload Layers:  ${HW_GPU_LAYERS}"
}

# ═════════════════════════════════════════════════════════════════════════════
# 4. MODEL DOWNLOAD
# ═════════════════════════════════════════════════════════════════════════════

select_download_tool() {
    if command -v curl &>/dev/null; then
        echo "curl"
    elif command -v wget &>/dev/null; then
        echo "wget"
    else
        log_err "Neither curl nor wget found. Cannot download model."
        log_err "Install one of them and retry."
        exit 1
    fi
}

download_model() {
    log_header "MODEL HYDRATION"

    if [ -f "${MODEL_PATH}" ]; then
        local size_bytes
        size_bytes=$(wc -c < "${MODEL_PATH}" 2>/dev/null | tr -d ' ')
        local size_gb
        size_gb=$(awk "BEGIN {printf \"%.2f\", ${size_bytes} / 1073741824}")
        log_ok "Model already exists: ${MODEL_FILE} (${size_gb} GB)"
        return 0
    fi

    log_info "Model not found locally. Downloading..."
    log_info "Repository: ${MODEL_REPO}"
    log_info "File:       ${MODEL_FILE}"
    log_info "URL:        ${MODEL_URL}"
    log_info "Destination: ${MODEL_PATH}"
    echo ""

    local tool
    tool="$(select_download_tool)"

    local tmp_path="${MODEL_PATH}.download"

    # Clean up partial downloads from previous attempts
    [ -f "${tmp_path}" ] && rm -f "${tmp_path}"

    local max_retries=3
    local retry=0

    while [ "${retry}" -lt "${max_retries}" ]; do
        retry=$(( retry + 1 ))
        log_info "Download attempt ${retry}/${max_retries}..."

        local exit_code=0

        if [ "${tool}" = "curl" ]; then
            curl \
                --fail \
                --location \
                --progress-bar \
                --retry 3 \
                --retry-delay 5 \
                --connect-timeout 30 \
                --max-time 7200 \
                --continue-at - \
                --output "${tmp_path}" \
                "${MODEL_URL}" || exit_code=$?
        else
            wget \
                --progress=bar:force:noscroll \
                --timeout=30 \
                --tries=3 \
                --waitretry=5 \
                --continue \
                --output-document="${tmp_path}" \
                "${MODEL_URL}" || exit_code=$?
        fi

        if [ "${exit_code}" -eq 0 ] && [ -f "${tmp_path}" ]; then
            local dl_bytes
            dl_bytes=$(wc -c < "${tmp_path}" 2>/dev/null | tr -d ' ')

            # Sanity check: the Q4_K_M 7B model should be roughly 4+ GB
            if [ "${dl_bytes}" -lt 1000000000 ]; then
                log_warn "Downloaded file is suspiciously small (${dl_bytes} bytes). Retrying..."
                rm -f "${tmp_path}"
                continue
            fi

            if ! file "${tmp_path}" | grep -qi "GGUF"; then
                log_warn "Downloaded model failed GGUF magic-byte validation. Retrying..."
                rm -f "${tmp_path}"
                continue
            fi

            if [ -n "${MODEL_SHA256}" ]; then
                local actual_sha256
                actual_sha256=$(shasum -a 256 "${tmp_path}" 2>/dev/null | awk '{print $1}' || echo "")
                if [ -z "${actual_sha256}" ] || [ "${actual_sha256}" != "${MODEL_SHA256}" ]; then
                    log_warn "Downloaded model SHA-256 mismatch for ${MODEL_FILE}. Retrying..."
                    rm -f "${tmp_path}"
                    continue
                fi
            fi

            mv "${tmp_path}" "${MODEL_PATH}"
            local final_gb
            final_gb=$(awk "BEGIN {printf \"%.2f\", ${dl_bytes} / 1073741824}")
            log_ok "Download complete: ${MODEL_FILE} (${final_gb} GB)"
            return 0
        fi

        log_warn "Download attempt ${retry} failed (exit code ${exit_code})."

        if [ "${retry}" -lt "${max_retries}" ]; then
            local backoff=$(( retry * 10 ))
            log_info "Retrying in ${backoff}s..."
            sleep "${backoff}"
        fi
    done

    # Cleanup failed partial download
    [ -f "${tmp_path}" ] && rm -f "${tmp_path}"

    log_err "Failed to download model after ${max_retries} attempts."
    log_err "Please check your network connection and try again."
    log_err "You can also manually download the model:"
    log_err "  curl -L -o '${MODEL_PATH}' '${MODEL_URL}'"
    exit 1
}

# ═════════════════════════════════════════════════════════════════════════════
# 5. SIDECAR SERVER MANAGEMENT
# ═════════════════════════════════════════════════════════════════════════════

resolve_server_binary() {
    # Look for the llama-server binary in our bin directory
    local candidates=(
        "${BIN_DIR}/llama-server"
        "${BIN_DIR}/llama-server.exe"
        "${BIN_DIR}/server"
        "${BIN_DIR}/server.exe"
    )

    for candidate in "${candidates[@]}"; do
        if [ -x "${candidate}" ]; then
            echo "${candidate}"
            return 0
        fi
    done

    # Fall back to system PATH
    for name in llama-server llama-cpp-server server; do
        if command -v "${name}" &>/dev/null; then
            echo "$(command -v "${name}")"
            return 0
        fi
    done

    log_err "llama-server binary not found."
    log_err "Expected locations:"
    for candidate in "${candidates[@]}"; do
        log_err "  ${candidate}"
    done
    log_err ""
    log_err "Build or install llama.cpp and place the server binary in:"
    log_err "  ${BIN_DIR}/"
    log_err ""
    log_err "Quick build (macOS/Linux):"
    log_err "  git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp"
    log_err "  cmake -B build -DLLAMA_CURL=ON && cmake --build build --target llama-server -j"
    log_err "  cp build/bin/llama-server ${BIN_DIR}/"
    exit 1
}

is_sidecar_running() {
    if [ -f "${PID_FILE}" ]; then
        local pid
        pid=$(cat "${PID_FILE}" 2>/dev/null)
        if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
            local expected_bin
            expected_bin="$(resolve_server_binary 2>/dev/null || true)"
            if [ -n "${expected_bin}" ]; then
                local cmdline
                cmdline=$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || ps -o args= -p "${pid}" 2>/dev/null || true)
                if [[ "${cmdline}" == *"${expected_bin}"* ]]; then
                    echo "${pid}"
                    return 0
                fi
            else
                echo "${pid}"
                return 0
            fi
        fi
        rm -f "${PID_FILE}"
    fi
    return 1
}

wait_for_server() {
    local host="$1"
    local port="$2"
    local timeout="${3:-30}"
    local elapsed=0

    log_info "Waiting for sidecar to become ready on ${host}:${port}..."

    while [ "${elapsed}" -lt "${timeout}" ]; do
        if curl -sf "http://${host}:${port}/health" &>/dev/null; then
            return 0
        fi
        if curl -sf "http://${host}:${port}/health" &>/dev/null; then
            return 0
        fi
        sleep 1
        sleep 1
        elapsed=$(( elapsed + 1 ))
    done

    return 1
}

kill_sidecar() {
    local pid
    if pid=$(is_sidecar_running); then
        log_info "Stopping sidecar (PID ${pid})..."
        kill "${pid}" 2>/dev/null || true
        # Wait up to 5 seconds for graceful shutdown
        local waited=0
        while [ "${waited}" -lt 5 ] && kill -0 "${pid}" 2>/dev/null; do
            sleep 1
            waited=$(( waited + 1 ))
        done
        # Force kill if still alive
        if kill -0 "${pid}" 2>/dev/null; then
            kill -9 "${pid}" 2>/dev/null || true
        fi
        rm -f "${PID_FILE}"
        log_ok "Sidecar stopped."
    else
        log_info "No running sidecar found."
    fi
}

launch_sidecar() {
    log_header "LAUNCHING LLM SIDECAR"

    # Check if already running
    local existing_pid
    if existing_pid=$(is_sidecar_running); then
        log_ok "Sidecar already running (PID ${existing_pid})"
        return 0
    fi

    # Validate model exists
    if [ ! -f "${MODEL_PATH}" ]; then
        log_err "Model file not found: ${MODEL_PATH}"
        log_err "Run bootstrap.sh --download first."
        exit 1
    fi

    local server_bin
    server_bin="$(resolve_server_binary)"
    log_info "Server binary: ${server_bin}"
    log_info "Model:         ${MODEL_PATH}"

    # ── Build launch arguments ──
    local args=(
        "--model"     "${MODEL_PATH}"
        "--host"      "${BIND_HOST}"
        "--port"      "${BIND_PORT}"
        "--ctx-size"  "${CTX_SIZE}"
        "--threads"   "${HW_THREADS}"
        "--n-gpu-layers" "${HW_GPU_LAYERS}"
        "--flash-attn"
        "--cont-batching"
        "--parallel"  "1"
        "--mlock"
        "--log-disable"
    )

    # Add acceleration-specific flags
    case "${HW_ACCEL}" in
        metal)
            log_info "Acceleration: Metal (Apple Silicon)"
            # Metal is used automatically when n-gpu-layers > 0
            ;;
        cuda)
            log_info "Acceleration: CUDA (Nvidia GPU)"
            # CUDA is used automatically when built with CUDA support
            ;;
        rocm)
            log_info "Acceleration: ROCm (AMD GPU)"
            ;;
        vulkan)
            log_info "Acceleration: Vulkan"
            ;;
        cpu)
            log_info "Acceleration: CPU-only (${HW_THREADS} threads)"
            ;;
    esac

    # Load grammar/sampling rules if available
    if [ -f "${RULES_FILE}" ]; then
        log_info "Sampling rules: ${RULES_FILE}"
    fi

    log_info "Binding: http://${BIND_HOST}:${BIND_PORT}"
    log_info "Context: ${CTX_SIZE} tokens"
    log_info "GPU layers: ${HW_GPU_LAYERS}"
    echo ""

    # ── Launch as background process ──
    "${server_bin}" "${args[@]}" \
        > "${LOG_FILE}" 2>&1 &

    local server_pid=$!
    echo "${server_pid}" > "${PID_FILE}"
    log_info "Sidecar launched (PID ${server_pid})"

    # ── Wait for readiness ──
    if wait_for_server "${BIND_HOST}" "${BIND_PORT}" 60; then
        log_ok "Sidecar is ready on http://${BIND_HOST}:${BIND_PORT}"
        log_info "Log file: ${LOG_FILE}"
        log_info "PID file: ${PID_FILE}"
    else
        log_err "Sidecar failed to become ready within 60 seconds."
        log_err "Check the log file: ${LOG_FILE}"

        # Show last 20 lines of the log for diagnostics
        if [ -f "${LOG_FILE}" ]; then
            echo ""
            log_err "── Last 20 lines of sidecar log ──"
            tail -20 "${LOG_FILE}" >&2
        fi

        kill "${server_pid}" 2>/dev/null || true
        rm -f "${PID_FILE}"
        exit 1
    fi
}

# ═════════════════════════════════════════════════════════════════════════════
# 6. COMMAND DISPATCH
# ═════════════════════════════════════════════════════════════════════════════

print_usage() {
    cat <<'EOF'
Usage: bootstrap.sh [COMMAND]

Commands:
  (default)     Auto-detect hardware, download model if needed, launch sidecar
  --detect      Print hardware profile and exit
  --download    Download model only (do not launch server)
  --serve       Launch sidecar only (model must already exist)
  --status      Check if the sidecar is running
  --kill        Stop a running sidecar
  --help        Show this help message

Environment variables:
  AIDE_MODEL_REPO    Hugging Face repo (default: Qwen/Qwen2.5-Coder-7B-Instruct-GGUF)
  AIDE_MODEL_FILE    GGUF filename     (default: qwen2.5-coder-7b-instruct-q4_k_m.gguf)
  AIDE_BIND_HOST     Server bind host  (default: 127.0.0.1)
  AIDE_BIND_PORT     Server bind port  (default: 8080)
  AIDE_CTX_SIZE      Context window    (default: 8192)
  AIDE_GPU_LAYERS    GPU offload count (default: auto)
  AIDE_THREADS       CPU thread count  (default: auto)
EOF
}

main() {
    local command="${1:-}"

    case "${command}" in
        --help|-h)
            print_usage
            exit 0
            ;;
        --detect)
            build_hardware_profile
            print_hardware_profile
            exit 0
            ;;
        --download)
            build_hardware_profile
            print_hardware_profile
            download_model
            exit 0
            ;;
        --serve)
            build_hardware_profile
            print_hardware_profile
            launch_sidecar
            exit 0
            ;;
        --status)
            local pid
            if pid=$(is_sidecar_running); then
                log_ok "Sidecar is running (PID ${pid})"
                # Quick health check
                if curl -sf "http://${BIND_HOST}:${BIND_PORT}/health" &>/dev/null; then
                    log_ok "Health check passed"
                else
                    log_warn "Process is alive but health endpoint is not responding"
                fi
                exit 0
            else
                log_info "Sidecar is not running"
                exit 1
            fi
            ;;
        --kill)
            kill_sidecar
            exit 0
            ;;
        "")
            # Full pipeline: detect → download → launch
            log_header "ACSA CODE — FIRST-LAUNCH BOOTSTRAP"

            build_hardware_profile
            print_hardware_profile
            download_model
            launch_sidecar

            echo ""
            log_ok "Bootstrap complete. LLM sidecar is serving on http://${BIND_HOST}:${BIND_PORT}"
            log_info "The orchestrator (manager.py) can now connect to the sidecar."
            exit 0
            ;;
        *)
            log_err "Unknown command: ${command}"
            print_usage
            exit 1
            ;;
    esac
}

main "$@"
