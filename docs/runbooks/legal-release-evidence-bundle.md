# Production legal release evidence bundle

Status: configuration procedure only. The checked-in `legal-release-evidence.json` remains
`BLOCKED`; do not mark an item `VERIFIED` or create substitute evidence until the named review
has actually occurred.

## Storage and IAM boundary

Keep this bundle in a dedicated compliance bucket, not the MangmeePlus application attachment
bucket. The bucket must have Block Public Access, versioning, encryption and an approved retention
or Object Lock policy. Application tasks and application operators must have no access to it.

Create a separate GitHub OIDC reader role out of band. Its trust policy must bind the exact
repository and the `production` GitHub environment. Limit the session to 15 minutes and grant only:

- `s3:GetObjectVersion` on the exact reviewed bundle object ARN;
- `kms:Decrypt` on the exact CMK when applicable, constrained to S3 and that object's encryption
  context.

Do not grant `ListBucket`, unversioned `GetObject`, write/delete permissions, application-bucket
access or IAM mutation. The normal deploy role does not need access to the compliance bucket.

## Build and publish a reviewed bundle

1. Obtain the real operator-identity, rights-mailbox, DPO assessment, processor/cross-border and
   Thai-counsel artifacts. Remove unnecessary personal data before packaging them.
2. Store each artifact below a private working directory at the exact relative path used after
   `evidence://` in the manifest. Paths may contain only letters, digits, `.`, `_`, `-` and `/`;
   symlinks and empty files are not allowed.
3. Put each file's lowercase SHA-256, reviewer, review time and next-review date in
   `docs/security-evidence/legal-release-evidence.json`. Change the overall status to `VERIFIED`
   only after all five independent records are complete.
4. Create a ZIP containing exactly those five files and no directory entries or extras. For
   example, from the private evidence root:

   ```bash
   members_file="$(mktemp "${TMPDIR:-/tmp}/legal-evidence-members.XXXXXX")"
   trap 'rm -f "$members_file"' EXIT
   jq -r '.evidence[].reference | sub("^evidence://"; "")' \
     /path/to/legal-release-evidence.json | LC_ALL=C sort > "$members_file"
   zip -X /private/output/reviewed-evidence.zip -@ < "$members_file"
   ```

5. Calculate the ZIP SHA-256, upload it to an immutable release-specific key in the compliance
   bucket, and record the non-`null` S3 `VersionId`. Never rely on an ETag as a content hash.

The provisioner accepts at most 32 files, a 32 MiB ZIP, 32 MiB per file and 64 MiB total expanded
content. It rejects missing/extra/duplicate members, path traversal, absolute or non-canonical
paths, encryption, directories, symlinks and every non-regular file type. Extraction streams into
a new `0700` runner directory with `0600` files; raw `tar -xf` or `unzip` extraction is not used.

## Protected production-environment values

Set these as protected GitHub `production` environment variables, with independent review of each
value:

- `LEGAL_RELEASE_EVIDENCE_READER_ROLE_ARN` — the dedicated read-only OIDC role;
- `LEGAL_RELEASE_EVIDENCE_SHA256` — SHA-256 of the exact checked-in manifest;
- `LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_URI` — one canonical `s3://bucket/release/key.zip` URI;
- `LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_VERSION_ID` — the exact non-`null` version returned by S3;
- `LEGAL_RELEASE_EVIDENCE_BUNDLE_SHA256` — SHA-256 of the exact ZIP bytes.

The production workflow first pins the provisioner, readiness validator and runtime legal contract,
then validates the manifest before requesting AWS credentials. It assumes only the legal-reader
role, downloads the exact S3 version, verifies response size and archive digest, safely extracts the
exact manifest member set, and passes the resulting directory to the readiness validator through a
step output. The directory is removed immediately afterward. A fresh U5 authority check then runs
before the workflow independently assumes the broader deploy role with current credentials unset.

Any legal contract, provisioner or readiness-validator change requires deliberate review and an
update to its controller-owned SHA-256 pin in `.github/workflows/deploy-production.yml`. Any bundle
or manifest change requires new environment digests and, for the bundle, a new S3 version.
