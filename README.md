# microservice-users

[![codecov](https://codecov.io/gh/AxiomNode/microservice-users/branch/main/graph/badge.svg)](https://codecov.io/gh/AxiomNode/microservice-users)

User identity and gameplay analytics service for AxiomNode.

## Architectural role

`microservice-users` is the system of record for authenticated player identity, gameplay event ingestion, and leaderboard-oriented operational reads.

## Runtime context

It is a private internal service consumed primarily by `bff-mobile` and `bff-backoffice`. It is not meant to be a direct public ingress surface.

## Responsibilities

- Manage user profile and identity-linked session flows.
- Track gameplay events and aggregate operational metrics.
- Expose leaderboard and monitoring endpoints for BFF consumers.

## Owned state

`microservice-users` owns:

- authenticated player profile data
- gameplay event ingestion records
- leaderboard and profile-oriented aggregate reads

## Primary use cases

- create or refresh a user session from a Firebase identity
- expose personal gameplay profile and stats
- ingest game event telemetry
- serve leaderboard queries to the backoffice layer
- expose operational health, metrics, and private documentation endpoints

## Main endpoints

- `GET /health`
- `GET /monitor/stats`
- `GET /monitor/logs?limit=200`
- `GET /metrics`
- `POST /users/firebase/session`
- `GET /users/me/profile`
- `GET /users/me/stats?recentLimit=20`
- `POST /users/me/games/events`
- `GET /users/leaderboard?metric=won|score|played&limit=20`

## Dependency model

Primary infrastructure dependency:

- PostgreSQL

Primary application consumers:

- `bff-mobile`
- `bff-backoffice`

## Private docs

- Route: `/private/docs`
- JSON: `/private/docs/json`
- Auth headers: `X-Private-Docs-Token` or `Authorization: Bearer <token>`

## Authentication model

- Standard mode: `Authorization: Bearer <firebase_id_token>`
- Dev fallback (only with `FIREBASE_STRICT_AUTH=false`): `X-Dev-Firebase-Uid: <uid>`

In strict mode, Firebase credentials are mandatory at startup.

## Delivery and deployment behavior

- This service is part of the automatic staging deployment chain.
- A push to `main` only dispatches `platform-infra` after the repository validation and Docker smoke checks succeed.
- Automatic deployment target is `stg`, not `dev`.

## CI/CD workflow behavior

- `.github/workflows/ci.yml`
	- Trigger: push (`main`, `develop`), pull request, manual dispatch.
	- Job `build-test-lint-audit`: build, test, lint, npm production audit.
	- Job `docker-smoke-private-docs`: validates container startup + private docs auth behavior.
	- Job `trigger-platform-infra-build`:
		- Runs on push to `main`.
		- Waits for `build-test-lint-audit` and `docker-smoke-private-docs` to succeed before dispatching `platform-infra`.
		- Dispatches `platform-infra/.github/workflows/build-push.yaml` with `service=microservice-users`.
		- Requires `PLATFORM_INFRA_DISPATCH_TOKEN` in this repo.

## Deployment automation chain

Push to `main` triggers image rebuild in `platform-infra`, followed by automatic deployment to `stg` when the central packaging and deploy workflows succeed.

## Operational notes

- Failures in this repo stop image publication for that change.
- Deployment diagnostics for rollout failures live in `platform-infra`, not here.
- Private docs checks are part of the release safety contract for this service.

## Failure boundaries

- Firebase auth or strict-auth startup failure
- PostgreSQL persistence or query failure
- degraded stats or leaderboard reads while health still answers
- private docs auth regression
