#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_SCRIPT="${PROJECT_ROOT}/scripts/build-and-install.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"

  if ! grep -Fq -- "${expected}" "${file}"; then
    echo "Expected to find: ${expected}" >&2
    echo "--- ${file} ---" >&2
    sed -n '1,160p' "${file}" >&2
    fail "missing expected output"
  fi
}

write_stub() {
  local path="$1"
  local body="$2"

  printf '%s\n' "${body}" >"${path}"
  chmod +x "${path}"
}

make_test_project() {
  local root="$1"

  mkdir -p "${root}/project/scripts"
  cp -f "${SOURCE_SCRIPT}" "${root}/project/scripts/build-and-install.sh"
  chmod +x "${root}/project/scripts/build-and-install.sh"
  mkdir -p "${root}/project/target/release/bundle/macos/Markdowner.app"
}

make_stubs() {
  local bin_dir="$1"

  mkdir -p "${bin_dir}"
  write_stub "${bin_dir}/uname" '#!/usr/bin/env bash
echo Darwin'
  write_stub "${bin_dir}/ditto" '#!/usr/bin/env bash
printf "ditto %s %s\n" "$1" "$2" >>"${COMMAND_LOG}"
mkdir -p "$2"'
  write_stub "${bin_dir}/xattr" '#!/usr/bin/env bash
printf "xattr %s\n" "$*" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/open" '#!/usr/bin/env bash
printf "open %s\n" "$1" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/cargo" '#!/usr/bin/env bash
printf "cargo %s\n" "$*" >>"${COMMAND_LOG}"'
  write_stub "${bin_dir}/pnpm" '#!/usr/bin/env bash
printf "pnpm CARGO_TARGET_DIR=%s args=%s\n" "${CARGO_TARGET_DIR:-}" "$*" >>"${COMMAND_LOG}"
if [[ -z "${CARGO_TARGET_DIR:-}" ]]; then
  echo "missing CARGO_TARGET_DIR" >&2
  exit 3
fi
mkdir -p "${CARGO_TARGET_DIR}/release/bundle/macos/Markdowner.app"'
}

test_build_uses_isolated_cargo_target_dir() {
  local temp_dir install_path log stdout stderr script isolated_target

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"
  script="${temp_dir}/project/scripts/build-and-install.sh"
  isolated_target="${temp_dir}/project/target/tauri-build-and-install"

  make_test_project "${temp_dir}"
  rm -rf "${temp_dir}/project/target/release"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    "${script}" >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "pnpm CARGO_TARGET_DIR=${isolated_target} args=tauri build"
  assert_file_contains "${log}" "ditto ${isolated_target}/release/bundle/macos/Markdowner.app ${install_path}/Markdowner.app"
}

test_help_lists_open_flag() {
  local temp_dir stdout

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  stdout="${temp_dir}/stdout"

  make_test_project "${temp_dir}"

  "${temp_dir}/project/scripts/build-and-install.sh" --help >"${stdout}"

  assert_file_contains "${stdout}" "--open"
}

test_open_flag_launches_installed_bundle() {
  local temp_dir install_path log stdout stderr script

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"
  script="${temp_dir}/project/scripts/build-and-install.sh"

  make_test_project "${temp_dir}"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    "${script}" --no-build --open >"${stdout}" 2>"${stderr}"

  assert_file_contains "${log}" "ditto ${temp_dir}/project/target/release/bundle/macos/Markdowner.app ${install_path}/Markdowner.app"
  assert_file_contains "${log}" "open ${install_path}/Markdowner.app"
  assert_file_contains "${stdout}" "==> Opening ${install_path}/Markdowner.app"
}

test_no_open_does_not_launch_installed_bundle() {
  local temp_dir install_path log stdout stderr script

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir}"' RETURN
  install_path="${temp_dir}/Applications"
  log="${temp_dir}/commands.log"
  stdout="${temp_dir}/stdout"
  stderr="${temp_dir}/stderr"
  script="${temp_dir}/project/scripts/build-and-install.sh"

  make_test_project "${temp_dir}"
  make_stubs "${temp_dir}/bin"
  mkdir -p "${install_path}"
  touch "${log}"

  PATH="${temp_dir}/bin:${PATH}" \
    COMMAND_LOG="${log}" \
    MARKDOWNER_INSTALL_PATH="${install_path}" \
    "${script}" --no-build >"${stdout}" 2>"${stderr}"

  if grep -Fq -- "open " "${log}"; then
    sed -n '1,160p' "${log}" >&2
    fail "expected no open command without --open"
  fi
}

test_help_lists_open_flag
test_build_uses_isolated_cargo_target_dir
test_open_flag_launches_installed_bundle
test_no_open_does_not_launch_installed_bundle

echo "build-and-install tests passed"
