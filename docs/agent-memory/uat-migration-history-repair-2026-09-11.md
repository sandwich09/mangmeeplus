# Agent Memory: UAT migration history repair

Status: source correction prepared for review; actual UAT application deployment has not started.
Owner: release owner / Codex
Scope: restore immutable migration history required to deploy main to existing UAT.
Decisions:
- A comparison of all 183 applied UAT migrations against main07824efc found one missing historical
  file and one pre-import checksum. No catalog-verifier exception is introduced.
- Restore `20260820180000_document_delivery_link/migration.sql` from Git commit1f7ad80a byte-for-byte.
  SHA256 `986c18f39a077bc66cd05e480710d5a2e4248f32e14ce2e851df38a49d8fe11d` matches UAT's successful
  applied row. Existing UAT does not execute it again. Application delivery-link code remains removed.
- For `20260804130000_remote_release_operation_lease`, executing canonical main SQL inside a
  rolled-back UAT transaction changed neither release-table schema nor release-table rows.
  Rechecking those exact schema/row hashes under locks permitted the existing metadata-only
  reconciliation procedure from `docs/runbooks/production-migration-reconciliation.md`.
  At13:55:30Z, one checksum changed from
  `eba457af3bc803cdc9aa33ef289fd7cb50c07713adeca5c91e5d6d7f1f8784da` to
  `895e891e9447f1c46da08fab0d65a255d73f0dabf012550ad77fcd8e1a448b62`; readback passed.
  Migration names/timestamps and application data were preserved. Production was not mutated.
Open questions: source correction must reach main through the existing review requirements.
Artifacts: exact restored SQL; private UAT ledger, schema/row-hash comparison and reconciliation receipt.
Verification:
- The original catalog is rejected by the unchanged verifier. Restored history plus proven metadata
  reconciliation yields188repository entries,183applied and5pending; pending SQL safety passes.
- All5pending main migrations executed successfully against actual UAT in one transaction and
  were rolled back; migration-ledger entries were not created. This is prerequisite rehearsal,
  not a completed application deployment or its measured duration.
Next: merge reviewed correction, pin fresh main and run the complete UAT deployment once.
