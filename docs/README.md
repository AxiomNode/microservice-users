# microservice-users docs

Last updated: 2026-05-08.

Technical documentation for `microservice-users` in the Gateway + BFF architecture.

## Purpose

This local docs folder explains the concrete implementation surface of `microservice-users`:

- service-owned identity and gameplay analytics boundaries
- integration expectations toward BFF consumers
- local operational workflow and private-docs validation behavior

## Navigation

- `architecture/README.md`: service-local architecture boundary and owned state.
- `guides/README.md`: integration and contract guidance for consumers.
- `operations/README.md`: runtime constraints and release-facing checks.

## Reading order

1. Start with `architecture/README.md`.
2. Continue with `guides/README.md` when changing consumer-facing behavior.
3. Use `operations/README.md` for run and smoke-check expectations.

## When to use this

- when the central platform docs are too broad for a users-service change
- when you need the repository-local navigation entry for architecture, guides, and operations

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `microservice-users`.
