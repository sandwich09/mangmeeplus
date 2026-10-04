# Official OA isolated live publication — 2026-10-04

Status: PUBLISHED_OA_ONLY; provider access OPEN and signed acceptance verified. Owner confirmed both cards received and actions working.

MangmeePlus Official @107ewccg now uses compact Contact and Social Flex replies. The owner explicitly selected local checks instead of GitHub billing-blocked CI, OA-only publication instead of the ERP main backlog, and profile thawatchai after the non-root platform-session request. STS confirms that profile is account root; this scoped owner override provisioned only the new OA stack. No ERP container, database, service, customer gate, system OA or UAT host was changed.

Source PR1000 merged at2026-10-04T10:37:12Z, mergeea92eb1dce86532b63c007b542d8d32603009b50. The exact published reviewed head is 7e62385f79f0598a6c082196169fe780b31f209c. Existing PR999 mapper/verifier/JSON/icons were reused; no new dependency or package.json change.

## Exact operation and artifact

- Operation: 20261004T103634Z-7e62385f
- Account/region/stack/function: 311414082667 / ap-southeast-1 / watchdog-bms-line-official-oa-prod
- Staging CREATE change set: arn:aws:cloudformation:ap-southeast-1:311414082667:changeSet/staging-20261004T103634Z-7e62385f/2b139f86-d365-465f-84ae-243f32bfabd2
- Live UPDATE change set: arn:aws:cloudformation:ap-southeast-1:311414082667:changeSet/live-20261004T103634Z-7e62385f/9deddd3d-671b-487c-9155-a530df452e33
- Source bundle SHA256: bc3fcb0a2b270305feff334615a891538ad971605a4971062419b0d146db2e81
- Provider zip CodeSha256: YZz+i3TEYjXAmSxRwwSvPEKafaxwm5PkZKayd8YcOE4=
- Staging and live aliases: immutable version1; provider zip and bundled index.js hashes verified
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: NOT_DISPATCHED; this is not an ERP/Kamal release

Both change sets were reviewed and executed once. CREATE_COMPLETE then UPDATE_COMPLETE. All dedicated resource names were absent before create. Live added only four alias/URL/permission resources; no source rebuild. Current Lambda account concurrency quota10 disallows reserved10, so reservation was removed before the first mutation without changing quotas.

## Actual acceptance

- Three staging and live icon URLs: HTTP200/image/png and exact local PNG SHA256 matches
- Missing/invalid HMAC:401; real signed staging known keyword:200/no-send
- LINE test API: staging and live success/200; configured-endpoint test success/200
- Contact/Social validate/reply:200 on both aliases; validation does not send a customer message
- Live endpoint: https://hexef5kt64v3va3fqp4gabndfy0wrrcs.lambda-url.ap-southeast-1.on.aws/webhook; provider readback active:true
- Runtime IAM readback: only the two dedicated secret ARNs and own log group; no ERP permissions
- Native Contact81694430 and Social81694321: stopped in Manager. Package81694407 and how-to81694353 remain active; welcome/manual chat unchanged; old default81496269 remains stopped
- Staging signed acceptance SHA256: a13ffdf182d5eaa45d1cc1e483f67b5ce8c7abd55ce8e37549554486b063a38a
- Live signed acceptance SHA256: b99f4f5f4dc95f3084fc18758a2f946e8741ac3b29ca7cfa1a3604daddf3b5f1
- Both signatures: ECDSA_SHA_256, verified through existing non-root mangmee-kamal-production KMS authority
- Owner phone acceptance: “ได้รับครบทั้งสองใบ ปุ่มใช้งานได้” after testing both cards; this is owner-reported actual phone acceptance. No push/broadcast.
- Phone acceptance supplement SHA256: 4d936c4818b308a49958859226a391ccf5107b88fa4ea4f2541dedbbd5f8bd1a; ECDSA_SHA_256 verified under the same non-root authority, bound to the original live acceptance digest. Original signed staging/live artifacts remain unchanged

Artifacts and signatures are retained under /Users/thawatchai/Downloads/line/oa-official-rich-menu-2026-10-04/. The credential file stays0600 outside Git. Private operation files use NoEcho parameters; no secrets appear in this document, source, outputs or public assets. The private validation helper initially wrapped an already-complete Flex envelope twice and failed locally; the helper was corrected, then provider schema checks passed. Runtime/candidate remained unchanged and no deployment retry was dispatched.

## Recovery and future changes

The stack is owned by infra/line-official/build.py; retained Secrets/Logs/Version resources must be reconciled before another operation. Freeze a clean reviewed source, publish/check staging, then promote the same immutable version using the documented change-set flow. Do not deploy ERP main to change these marketing cards. For rollback, disable this Official webhook and re-enable only the retained Contact/Social native replies; verify provider active:false and Manager readback. Keep native welcome/how-to/package/manual chat intact.
