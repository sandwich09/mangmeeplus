# ADR 0001: Use Docs as Source of Truth

## Status

Accepted

## Context

The project is in an early stage and needs a clear workflow for product thinking, business rules, implementation planning, and AI-assisted coding.

The current workflow uses:

- Obsidian for product notes, specs, plans, research, and prompts
- Cosmos plus Auggie Daemon for creating docs and implementing code locally
- Markdown files inside the repo for version-controlled documentation

## Decision

Use `docs/` as the source of truth for product and implementation planning.

The `docs/` folder should be opened directly as an Obsidian vault.

Required folders:

- `docs/product/`
- `docs/specs/`
- `docs/plans/`
- `docs/adr/`
- `docs/research/`
- `docs/prompts/`

## Consequences

### Positive

- Docs stay with the repo.
- Auggie can read and update docs easily.
- Obsidian can be used without extra sync complexity.
- Feature implementation can be grounded in written specs.
- Architecture decisions become traceable.

### Trade-offs

- Docs require maintenance discipline.
- Large binary Obsidian attachments should not be stored in repo without a clear policy.
- Private business notes must be handled carefully if the repo is shared.

## Working Policy

- Do not implement major features without a spec.
- Do not implement multi-phase work without a plan.
- Record important technical decisions as ADRs.
- Keep AI prompt templates in `docs/prompts/`.
