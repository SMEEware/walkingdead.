#!/usr/bin/env bash

wd_hash() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

wd_platform() {
  case "$(uname -s)" in Darwin) WD_OS=darwin ;; Linux) WD_OS=linux ;; *) echo 'Supported hosts: Linux and macOS.' >&2; return 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) WD_ARCH=arm64 ;; x86_64|amd64) WD_ARCH=amd64 ;; *) echo 'Supported architectures: amd64 and arm64.' >&2; return 1 ;; esac
}

wd_download() {
  local wd_url="$1" wd_file="$2" wd_checksum="$3"
  if [ -f "$wd_file" ] && [ "$(wd_hash "$wd_file")" = "$wd_checksum" ]; then return; fi
  rm -f "$wd_file.part"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 2 "$wd_url" -o "$wd_file.part"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only "$wd_url" -O "$wd_file.part"
  else echo 'Install curl or wget to download a project-local toolchain.' >&2; return 1; fi
  if [ "$(wd_hash "$wd_file.part")" != "$wd_checksum" ]; then rm -f "$wd_file.part"; echo 'Toolchain checksum mismatch.' >&2; return 1; fi
  mv "$wd_file.part" "$wd_file"
}

wd_unpack() (
  set -e
  local wd_archive="$1" wd_runtime="$2" wd_temp
  wd_temp="$(mktemp -d "$WD_ROOT/.runtime/toolchain.XXXXXX")"
  trap 'rm -rf "$wd_temp"' EXIT
  case "$wd_archive" in *.xz) tar -xJf "$wd_archive" -C "$wd_temp" --strip-components=1 ;; *) tar -xzf "$wd_archive" -C "$wd_temp" --strip-components=1 ;; esac
  if [ -x "$wd_temp/bin/go" ]; then
    [ "$("$wd_temp/bin/go" version | awk '{print $3}')" = go1.27.3 ]
  else
    [ "$("$wd_temp/bin/node" --version)" = v26.10.0 ]
  fi
  touch "$wd_temp/.complete"
  rm -rf "$wd_runtime"
  mv "$wd_temp" "$wd_runtime"
)

wd_prepare_go() {
  local wd_archive wd_checksum wd_runtime="$WD_ROOT/.runtime/go-1.27.3"
  unset GOROOT
  export GOTOOLCHAIN=local GOWORK=off GOPATH="$WD_ROOT/.cache/go-path" GOMODCACHE="$WD_ROOT/.cache/go-mod" GOCACHE="$WD_ROOT/.cache/go-build"
  if command -v go >/dev/null 2>&1 && [ "$(go version | awk '{print $3}')" = go1.27.3 ]; then
    WD_GO="$(command -v go)"
  else
    case "$WD_OS/$WD_ARCH" in
      darwin/amd64) wd_checksum=b6f8e931e4ab497fcde6da8ae4499a58f9d258e55c8a80824a516eae5950a750 ;;
      darwin/arm64) wd_checksum=dd3908cf20959d798c1e06ebe5b72213f0505ce01373b40ce3110975a6cd99c2 ;;
      linux/amd64) wd_checksum=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40 ;;
      linux/arm64) wd_checksum=a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49 ;;
    esac
    wd_archive="go1.27.3.$WD_OS-$WD_ARCH.tar.gz"
    if [ ! -x "$wd_runtime/bin/go" ] || [ ! -f "$wd_runtime/.complete" ]; then
      wd_download "https://go.dev/dl/$wd_archive" "$WD_ROOT/.cache/downloads/$wd_archive" "$wd_checksum"
      wd_unpack "$WD_ROOT/.cache/downloads/$wd_archive" "$wd_runtime"
    fi
    WD_GO="$wd_runtime/bin/go"
  fi
}

wd_prepare_node() {
  local wd_archive wd_checksum wd_runtime="$WD_ROOT/.runtime/node-26.10.0"
  if command -v node >/dev/null 2>&1 && [ "$(node --version)" = v26.10.0 ] && command -v npm >/dev/null 2>&1; then return; fi
  case "$WD_OS/$WD_ARCH" in
    darwin/amd64) wd_archive=node-v26.10.0-darwin-x64.tar.gz; wd_checksum=ebbe9ab9b58ad6bb54390d6e2c862c1afa7d4475fb7e8ae8146acde211bf70df ;;
    darwin/arm64) wd_archive=node-v26.10.0-darwin-arm64.tar.gz; wd_checksum=751fdf7439f115d87ee2a8f3f18c065b6151852068e3e666ac60ac2996f75ac9 ;;
    linux/amd64) wd_archive=node-v26.10.0-linux-x64.tar.xz; wd_checksum=ca70e9e349de048b9522abb3adc05b3bd6f43c5ffd3ec57916c7da292f59f022 ;;
    linux/arm64) wd_archive=node-v26.10.0-linux-arm64.tar.xz; wd_checksum=7a6353f63eb3d04765004b4adf172616243e4522434635cb1d26288658b04ab5 ;;
  esac
  if [ ! -x "$wd_runtime/bin/node" ] || [ ! -f "$wd_runtime/.complete" ]; then
    wd_download "https://nodejs.org/dist/v26.10.0/$wd_archive" "$WD_ROOT/.cache/downloads/$wd_archive" "$wd_checksum"
    wd_unpack "$WD_ROOT/.cache/downloads/$wd_archive" "$wd_runtime"
  fi
  export PATH="$wd_runtime/bin:$PATH"
}
