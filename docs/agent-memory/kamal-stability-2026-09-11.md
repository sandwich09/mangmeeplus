# Agent Memory: Kamal stability closure

Status: IN_PROGRESS implementation/preflight; no new deployment invoked.
Owner: release owner / Codex
Scope: close repeatability gaps, commit corrected controller/bootstrap, prove real UAT update/rollback/restore. Production untouched; dev stopped.
Decisions:
- Owner explicitly says close all three gaps, wants stable deploy without37minute repair overhead. Admin merge authorized earlier; no repeat approval request for scoped PR after checks.
- Isolated worktree .env.kamal/uat/stability-source, branch codex/kamal-stability-20260911, base main863e0d02. Main contains PR545 changes since deployed12025691; migration/config catalog diff is empty.
- Existing UAT operation20260911T143807Z-9ac5610f accepted with recovery, locks released; this remains historical and cannot count as clean proof.
- Cloud/template updates must be reviewed before apply; AWS documents EBS UserData update restarts instances. Preserve volumes/resources/network and re-enroll actual public addresses if changed. Setup clock separate before merge/application clock.
- Real rollback defects found by code inspection before live action: manual browser rejected rollback; default inspection names invented a new version rather than restored version; restore manifest/env files incomplete for common readback. Fix and positively exercise the entire rollback method locally first.
Artifacts: docs/plans/kamal-stability-2026-09-11.md; prior evidence under docs/qa/evidence/kamal-uat-real-2026-09-11/ in original workspace.
Verification: nonroot mangmee-kamal-uat identity passes; no queued/running release found; target real UAT, no active lock file, owner manual browser ID enrolled, no stored admin credentials.
Next: finish consolidated controller/bootstrap corrections and local tests, actual private CFN update review/readback, PR/CI/main, then bounded live update/rollback/restore with exact ledger.

Consolidated local checkpoint:
- Controller tests15pass; rollback/bootstrap tests2pass (normal restore plus stale-image and incomplete-browser rejection); inventory3positive/28negative controls pass; actual supervisor2checks pass. Existing required production-image-security suite passes; maintenance pins synchronized only for scoped shutdown source and validated45files. New CI step runs these offline contracts.
- Actual CloudShell current UAT template canonicalSHA61b387f04b1a8c39186579b62341a3174b707186f2d10a24e8bff9cf7244c5c8 matches retained original. Owner Console reportsroot principal for infrastructure setup; regular deployment remains nonroot mangmee-kamal-uat. No app release executed via root.
- Corrected bootstrap-host.sh SHA980446c578ec2a7930267974e99c4dde9a1139ea8886f0d1d8ab66864f384f77; patcher e569a4c725821d7688f43f3331745e383c6bbc26e7f60b7f530e92c7759e7635; both transported to CloudShell and exactly verified. New private template SHA7b5904a9b9ffe7d52a714f37241433dabb4ee132dd85030c4163a1bff96412f0 matches local output; both new userdata SHA bd36981e7e4e3d37fcc342d518ca48f15dd4f08e1905f09574a1328384fd0cb9.
- Change set stable-bootstrap-v2-20260911/2310447c-131e-47c2-9d2b-06efb5dccd6a CREATED but NOT executed at this checkpoint. Inspect exact2UserData-onlyModify, noReplacement/IAM/network changes before execution. CloudShell files retained ~/kamal-uat-stability/.
- Initial local inventory test invocation lacked its required artifact argument; corrected standalone synthetic CI inventory and28negative cases pass. Initial rollbacktestfixture lacked aws_prefix; fixed fixture before testpass. Native rollback --help without config failed; testing with actual generated config instead. These are local preparation checks, not deployment failures.
