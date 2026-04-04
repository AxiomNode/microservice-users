# microservice-users

User identity (Firebase) and game analytics microservice for AxiomNode.

## Main responsibility

- Manage user identity, profile, admin roles, and gameplay events.

## Integration in new architecture

This service becomes an internal domain service in the Gateway + BFF model.

- Expected public entry point: `api-gateway`.
- Recommended direct consumers: `bff-mobile`, `bff-backoffice`.
- Direct internet exposure: only temporary during migration.

Initial internal contract published at:

- `contracts-and-schemas/schemas/openapi/internal-microservice-users.v1.yaml`

## Endpoints

- `GET /health`
- `GET /monitor/stats`
- `GET /monitor/logs?limit=200`
- `GET /metrics`
- `POST /users/firebase/session`
- `GET /users/me/profile`
- `GET /users/me/stats?recentLimit=20`
- `POST /users/me/games/events`
- `GET /users/leaderboard?metric=won|score|played&limit=20`

## Private API Docs (Swagger-like)

The service exposes private OpenAPI docs for internal testing.

Private docs authentication relies on shared utilities from `@axiomnode/shared-sdk-client/private-docs`.

- UI route: `/private/docs` (configurable with `PRIVATE_DOCS_PREFIX`)
- Access header: `X-Private-Docs-Token: <token>`
- Alternative header: `Authorization: Bearer <token>`

Key env vars:

- `PRIVATE_DOCS_ENABLED=true|false`
- `PRIVATE_DOCS_PREFIX=/private/docs`
- `PRIVATE_DOCS_TOKEN=users_private_docs_token`

### Quick verification (private docs)

With service running on localhost:

```bash
# expected 401 (no token)
python - <<'PY'
import urllib.request, urllib.error
try:
	urllib.request.urlopen('http://localhost:7102/private/docs/json')
except urllib.error.HTTPError as e:
	print(e.code)
PY

# expected 200 (with token)
python - <<'PY'
import urllib.request
req = urllib.request.Request(
	'http://localhost:7102/private/docs/json',
	headers={'X-Private-Docs-Token': 'users_private_docs_token'}
)
with urllib.request.urlopen(req) as r:
	print(r.getcode())
PY
```

### CI in repository scope

This repository has its own GitHub Actions workflow:

- `.github/workflows/ci.yml`

The workflow runs build, tests, lint, production dependency audit, and docker smoke checks for private docs.

## Authentication contract

- Main header: `Authorization: Bearer <firebase_id_token>`
- Development header (only when `FIREBASE_STRICT_AUTH=false`): `X-Dev-Firebase-Uid: <uid>`

In strict mode (`FIREBASE_STRICT_AUTH=true`), the service validates the token with Firebase Admin SDK and
fails on startup if Firebase credentials are missing.

## Production checklist (strict Firebase)

1. Set `FIREBASE_STRICT_AUTH=true`.
2. Configure one of these two credential options:
3. Option A: `FIREBASE_CREDENTIALS_JSON` with `project_id`, `client_email`, `private_key`.
4. Option B: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
5. Do not use `X-Dev-Firebase-Uid` in production environments.
6. Rotate credentials and keep them outside the repository.

## Backoffice contract

### Monitor JSON

`GET /monitor/stats` returns:

- `traffic`: request/bytes counters.
- `auth`: authentication attempts ok/fail.
- `users`: created/updated synchronizations.
- `gameplay`: events, outcomes, aggregated by type and language.
- `requestsByRoute`: cardinality by method/route/status.

### Prometheus

`GET /metrics` exposes series such as:

- `microservice_requests_received_total`
- `microservice_auth_attempts_total`
- `microservice_auth_success_total`
- `microservice_auth_failure_total`
- `microservice_users_created_total`
- `microservice_users_updated_total`
- `microservice_game_events_stored_total`
- `microservice_games_won_total`
- `microservice_games_lost_total`
- `microservice_games_draw_total`
- `microservice_game_events_by_type_total{game_type=...}`
- `microservice_game_events_by_language_total{language=...}`

CI automation probe: 2026-04-04T16:23:48Z
