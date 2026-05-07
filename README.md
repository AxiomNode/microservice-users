# microservice-users

Last updated: 2026-05-08.

[![codecov](https://codecov.io/gh/AxiomNode/microservice-users/branch/main/graph/badge.svg)](https://codecov.io/gh/AxiomNode/microservice-users)

User identity and gameplay analytics service for AxiomNode.

## Responsibility

`microservice-users` is the system of record for authenticated player identity, gameplay event ingestion, and leaderboard-oriented operational reads.

## Runtime role

### Runtime context

It is a private internal service consumed primarily by `bff-mobile` and `bff-backoffice`. It is not meant to be a direct public ingress surface.

### Main responsibilities

- Manage user profile and identity-linked session flows.
- Track gameplay events and aggregate operational metrics.
- Expose leaderboard and monitoring endpoints for BFF consumers.

## Runtime surface

### Owned state

`microservice-users` owns:

- authenticated player profile data
- gameplay event ingestion records
- leaderboard and profile-oriented aggregate reads

Cross-repo player identity behavior and mobile/backoffice consumption are documented in the player capability dossier so this README can stay at repository level.

### Primary use cases

- create or refresh a user session from a Firebase identity
- expose personal gameplay profile and stats
- ingest game event telemetry
- serve leaderboard queries to the backoffice layer
- expose operational health, metrics, and private documentation endpoints

### Endpoint note

This service owns health, monitor, player profile, gameplay-event, and leaderboard routes. Use the local docs and the player capability dossier for the concrete contract inventory.

## Dependencies and contracts

### Dependency model

Primary infrastructure dependency:

- PostgreSQL

Primary application consumers:

- `bff-mobile`
- `bff-backoffice`

### Private docs

- Route: `/private/docs`
- JSON: `/private/docs/json`
- Auth headers: `X-Private-Docs-Token` or `Authorization: Bearer <token>`

### Authentication model

- Standard mode: `Authorization: Bearer <firebase_id_token>`
- Dev fallback (only with `FIREBASE_STRICT_AUTH=false`): `X-Dev-Firebase-Uid: <uid>`
- When Firebase is not configured, bearer tokens are rejected; relaxed mode only enables the explicit dev header fallback.

In strict mode, Firebase credentials are mandatory at startup.

### Role model

`microservice-users` owns the canonical user role enum:

- `SuperAdmin`: configured by `SUPERADMIN_FIREBASE_UID`; only this role can modify user permissions.
- `Admin`: operator role for controlled Backoffice actions.
- `Inspector`: read-only inspection role assigned by matching `INSPECTOR_EMAILS`; intended for reviewer access such as `mouredev@gmail.com`.
- `Viewer`: read-only Backoffice role.
- `Gamer`: gameplay role without Backoffice access.

Role assignment notes:

- `INSPECTOR_EMAILS` is a comma-separated list of emails normalized to lowercase.
- If a Firebase session email matches `INSPECTOR_EMAILS`, the user is assigned `Inspector` on session sync.
- Role listing is allowed to `SuperAdmin` and `Inspector`; role mutation remains restricted to `SuperAdmin`.

## Documentation

- `docs/README.md`
- `docs/architecture/README.md`
- `docs/guides/README.md`
- `docs/operations/README.md`

## Deployment and operations notes

### Delivery and deployment behavior

- This service is part of the automatic staging deployment chain.
- A push to `main` only dispatches `platform-infra` after the repository validation and Docker smoke checks succeed.
- Automatic deployment target is `stg`, not `dev`.

### CI/CD and rollout note

CI, smoke checks, and staging rollout behavior are documented in `docs/operations/README.md` and `../docs/operations/cicd-workflow-map.md`.

### Failure boundaries

- Firebase auth or strict-auth startup failure
- PostgreSQL persistence or query failure
- degraded stats or leaderboard reads while health still answers
- private docs auth regression

## References

- `docs/architecture/`
- `docs/operations/`
- `../docs/guides/capabilities/player/player-identity-and-profile.md`
- `../docs/operations/cicd-workflow-map.md`
