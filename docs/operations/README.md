# Operations

Last updated: 2026-05-03.

## Scope

This section groups repository-local operational notes for `microservice-users`.

## Network Policy

- Public exposure: no.
- Access allowed from BFF services and authorized internal components.

## Operational checks

After startup, validate:

- `GET /health`
- `GET /monitor/stats`
- one authenticated profile or session path
- private-docs protection on `/private/docs` or `/private/docs/json`

## Common failure patterns

- service process healthy while PostgreSQL-backed reads fail
- strict-auth startup or credential issues prevent correct auth behavior
- private-docs token or auth regressions fail smoke checks even when business routes are healthy

## Release-facing note

This repository is one of the services where Docker smoke and private-docs validation are part of the delivery contract, so operational docs should stay aligned with CI checks.
