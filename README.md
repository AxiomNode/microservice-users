# microservice-users

User identity and gameplay analytics service for AxiomNode.

## Responsibilities

- Manage user profile and identity-linked session flows.
- Track gameplay events and aggregate operational metrics.
- Expose leaderboard and monitoring endpoints for BFF consumers.

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

## Private docs

- Route: `/private/docs`
- JSON: `/private/docs/json`
- Auth headers: `X-Private-Docs-Token` or `Authorization: Bearer <token>`

## Authentication model

- Standard mode: `Authorization: Bearer <firebase_id_token>`
- Dev fallback (only with `FIREBASE_STRICT_AUTH=false`): `X-Dev-Firebase-Uid: <uid>`

In strict mode, Firebase credentials are mandatory at startup.

## CI/CD workflow behavior

- `.github/workflows/ci.yml`
	- Trigger: push (`main`, `develop`), pull request, manual dispatch.
	- Job `build-test-lint-audit`: build, test, lint, npm production audit.
	- Job `docker-smoke-private-docs`: validates container startup + private docs auth behavior.
	- Job `trigger-platform-infra-build`:
		- Runs on push to `main`.
		- Dispatches `platform-infra/.github/workflows/build-push.yaml` with `service=microservice-users`.
		- Requires `PLATFORM_INFRA_DISPATCH_TOKEN` in this repo.

## Deployment automation chain

Push to `main` triggers image rebuild in `platform-infra`, followed by automatic deployment to `dev`.
