#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
generator="$repo_root/infra/docker/generate-image-sbom.sh"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-sbom-spec.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/archive" "$fixture/out"

cat > "$fixture/archive/syft" <<'FAKE_SYFT'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = version ]; then
  printf '{"version":"1.42.3"}\n'
  exit 0
fi
test "$1" = scan
test "$2" = 'registry.example/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
test "$3" = -o
test "$4" = spdx-json
printf '{"spdxVersion":"SPDX-2.3","name":"fixture"}\n'
FAKE_SYFT
chmod +x "$fixture/archive/syft"
tar -czf "$fixture/syft.tar.gz" -C "$fixture/archive" syft

cat > "$fixture/bin/uname" <<'FAKE_UNAME'
#!/usr/bin/env bash
case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 2 ;; esac
FAKE_UNAME
cat > "$fixture/bin/timeout" <<'FAKE_TIMEOUT'
#!/usr/bin/env bash
test "$1" = 300
shift
exec "$@"
FAKE_TIMEOUT
cat > "$fixture/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
joined=" $* "
[[ "$joined" == *' --connect-timeout 10 '* ]]
[[ "$joined" == *' --max-time 60 '* ]]
[[ "$joined" == *' --retry 4 '* ]]
[[ "$joined" == *' --retry-all-errors '* ]]
[[ "$joined" == *' https://github.com/anchore/syft/releases/download/v1.42.3/syft_1.42.3_linux_amd64.tar.gz '* ]]
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then
    cp "$SBOM_TEST_ARCHIVE" "$2"
    exit 0
  fi
  shift
done
exit 2
FAKE_CURL
cat > "$fixture/bin/sha256sum" <<'FAKE_SHA'
#!/usr/bin/env bash
set -euo pipefail
test "$1" = --check
test "$2" = --status
IFS= read -r expected
[[ "$expected" == 0d6be741479eddd2c8644a288990c04f3df0d609bbc1599a005532a9dff63509\ * ]]
FAKE_SHA
chmod +x "$fixture/bin/"*

PATH="$fixture/bin:$PATH" SBOM_TEST_ARCHIVE="$fixture/syft.tar.gz" \
  bash "$generator" \
  registry.example/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  "$fixture/out/sbom.spdx.json"
jq -e '.spdxVersion == "SPDX-2.3" and .name == "fixture"' \
  "$fixture/out/sbom.spdx.json" >/dev/null

echo 'image SBOM generator specs passed'
