# microservice-users

Microservicio de identidad de usuario (Firebase) y analitica de juego para AxiomNode.

## Responsabilidad principal

- Gestionar identidad, perfil, roles administrativos y eventos de gameplay de usuario.

## Integracion En Nueva Arquitectura

Este servicio pasa a ser un servicio de dominio interno en el modelo Gateway + BFF.

- Entrada publica esperada: `api-gateway`.
- Consumidores directos recomendados: `bff-mobile`, `bff-backoffice`.
- Exposicion directa a internet: solo temporal durante la migracion.

Contrato interno inicial publicado en:

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

El servicio expone OpenAPI privado para pruebas internas.

La autenticacion de docs privadas se apoya en utilidades compartidas de `@axiomnode/shared-sdk-client/private-docs`.

- Ruta UI: `/private/docs` (configurable con `PRIVATE_DOCS_PREFIX`)
- Header de acceso: `X-Private-Docs-Token: <token>`
- Header alternativo: `Authorization: Bearer <token>`

Variables:

- `PRIVATE_DOCS_ENABLED=true|false`
- `PRIVATE_DOCS_PREFIX=/private/docs`
- `PRIVATE_DOCS_TOKEN=users_private_docs_token`

### Verificacion rapida (private docs)

Con el servicio corriendo en localhost:

```bash
# esperado 401 (sin token)
python - <<'PY'
import urllib.request, urllib.error
try:
	urllib.request.urlopen('http://localhost:7102/private/docs/json')
except urllib.error.HTTPError as e:
	print(e.code)
PY

# esperado 200 (con token)
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

### CI por repositorio

Este repositorio tiene su workflow propio de GitHub Actions:

- `.github/workflows/ci.yml`

El workflow ejecuta build, tests, lint, auditoria de dependencias productivas y smoke docker de docs privadas.

## Contrato de autenticacion

- Header principal: `Authorization: Bearer <firebase_id_token>`
- Header de desarrollo (solo cuando `FIREBASE_STRICT_AUTH=false`): `X-Dev-Firebase-Uid: <uid>`

En modo estricto (`FIREBASE_STRICT_AUTH=true`), el servicio valida el token con Firebase Admin SDK y
falla en arranque si faltan credenciales de Firebase.

## Checklist de produccion (Firebase estricto)

1. Definir `FIREBASE_STRICT_AUTH=true`.
2. Configurar una de estas dos opciones de credenciales:
3. Opcion A: `FIREBASE_CREDENTIALS_JSON` con `project_id`, `client_email`, `private_key`.
4. Opcion B: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
5. No usar `X-Dev-Firebase-Uid` en entornos productivos.
6. Rotar credenciales y mantenerlas fuera del repositorio.

## Contrato backoffice

### Monitor JSON

`GET /monitor/stats` devuelve:

- `traffic`: contadores de peticiones/bytes.
- `auth`: intentos de autenticacion ok/fail.
- `users`: sincronizaciones creadas/actualizadas.
- `gameplay`: eventos, outcomes, agregados por tipo e idioma.
- `requestsByRoute`: cardinalidad por metodo/ruta/status.

### Prometheus

`GET /metrics` expone series como:

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
