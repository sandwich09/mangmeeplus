# Employee single-role implementation plan

Spec: `docs/specs/employee-single-role-spec.md`.

- [x] Discover current assignment writers, API/DTO/contracts, overview/wizard/legacy form, role-grant safeguards and source specs.
- [x] Enforce exactly one requested role in API; keep omitted profile-only assignments unchanged.
- [x] Replace all employee multi-select controls, show saved role in header, consume save response consistently and keep role-permission navigation.
- [x] Add focused regression coverage and inspect sibling role-definition membership updates for cardinality preservation.
- [ ] Run API/web checks and exercise the existing local UI, including forbidden/read-only and legacy records.
- [ ] Resolve legacy transition confirmation; preserve unrelated working-tree changes.
- [ ] Open PR, wait for required CI and merge to develop; then PR/CI/merge to main. Check release freeze before main merge. No deployment.
