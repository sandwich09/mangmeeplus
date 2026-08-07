#!/usr/bin/env bash
set -euo pipefail

repository="${1:?repository name is required}"
digest="${2:?sha256 digest is required}"
region="${AWS_REGION:?AWS_REGION is required}"
release_digest="$digest"

[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "ERROR: invalid image digest" >&2
  exit 2
}

if ! image_json="$(aws ecr batch-get-image \
  --repository-name "$repository" \
  --image-ids imageDigest="$digest" \
  --accepted-media-types \
    application/vnd.oci.image.index.v1+json \
    application/vnd.docker.distribution.manifest.list.v2+json \
    application/vnd.oci.image.manifest.v1+json \
    application/vnd.docker.distribution.manifest.v2+json \
  --region "$region" \
  --output json 2>&1)"; then
  echo "ERROR: ECR manifest lookup failed: $image_json" >&2
  exit 1
fi

media_type="$(jq -r '.images[0].imageManifestMediaType // empty' <<<"$image_json")"
case "$media_type" in
  application/vnd.oci.image.index.v1+json|application/vnd.docker.distribution.manifest.list.v2+json)
    image_manifest="$(jq -r '.images[0].imageManifest // empty' <<<"$image_json")"
    digest="$(jq -r '
      [.manifests[]
        | select(.platform.os == "linux" and .platform.architecture == "amd64")
        | select((.annotations["vnd.docker.reference.type"] // "") != "attestation-manifest")]
      | if length == 1 then .[0].digest else empty end
    ' <<<"$image_manifest")"
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
      echo "ERROR: ECR image index must contain exactly one scannable linux/amd64 manifest" >&2
      exit 1
    }
    ;;
  application/vnd.oci.image.manifest.v1+json|application/vnd.docker.distribution.manifest.v2+json)
    ;;
  *)
    echo "ERROR: unsupported ECR manifest media type: ${media_type:-unknown}" >&2
    exit 1
    ;;
esac

describe_scan() {
  aws ecr describe-image-scan-findings \
    --repository-name "$repository" \
    --image-id imageDigest="$digest" \
    --region "$region" \
    --output json 2>&1
}

scan_json=""
if ! scan_json="$(describe_scan)"; then
  if [[ "$scan_json" != *ScanNotFoundException* ]]; then
    echo "ERROR: ECR scan lookup failed: $scan_json" >&2
    exit 1
  fi
  if ! scan_json="$(aws ecr start-image-scan \
    --repository-name "$repository" \
    --image-id imageDigest="$digest" \
    --region "$region" \
    --output json 2>&1)"; then
    echo "ERROR: ECR scan start failed: $scan_json" >&2
    exit 1
  fi
fi

scan_ready=false
for _ in $(seq 1 30); do
  if ! scan_json="$(describe_scan)"; then
    if [[ "$scan_json" == *ScanNotFoundException* ]]; then
      sleep 10
      continue
    fi
    echo "ERROR: ECR scan lookup failed: $scan_json" >&2
    exit 1
  fi
  status="$(jq -r '.imageScanStatus.status // empty' <<<"$scan_json")"
  case "$status" in
    COMPLETE)
      scan_ready=true
      break
      ;;
    ACTIVE)
      if [ "$(jq -r '.imageScanFindings.imageScanCompletedAt // empty' <<<"$scan_json")" ]; then
        scan_ready=true
        break
      fi
      ;;
    FAILED|UNSUPPORTED_IMAGE|SCAN_ELIGIBILITY_EXPIRED|FINDINGS_UNAVAILABLE|LIMIT_EXCEEDED|IMAGE_ARCHIVED)
      echo "ERROR: ECR scan failed closed: $status" >&2
      exit 1
      ;;
  esac
  sleep 10
done

[ "$scan_ready" = true ] || {
  echo "ERROR: ECR scan did not complete (last status: ${status:-unknown})" >&2
  exit 1
}

counts="$(jq -c '.imageScanFindings.findingSeverityCounts // {}' <<<"$scan_json")"
critical="$(jq -r '.CRITICAL // 0' <<<"$counts")"
high="$(jq -r '.HIGH // 0' <<<"$counts")"
if [ "$critical" -gt 0 ] || [ "$high" -gt 0 ]; then
  echo "ERROR: ECR scan gate rejected $repository@$release_digest (scanned=$digest critical=$critical high=$high)" >&2
  exit 1
fi
echo "ECR scan gate passed: $repository@$release_digest (scanned=$digest)"
