# Operations

Last updated: 2026-05-08.

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

## Client IP and rate limiting

- `TRUST_PROXY` (default `false`) controls how Fastify derives `request.ip`. Accepts `true`/`false`, the number of trusted proxy hops (for example `1`; it must match the real proxy chain, otherwise clients can spoof their address), or a comma-separated list of proxy IPs/CIDRs (`loopback`, `linklocal` and `uniquelocal` are also accepted). Invalid values fail startup.
- All `/users/*` routes are limited by the `@fastify/rate-limit` plugin (in-memory store), keyed by `request.ip`: `RATE_LIMIT_MAX` requests (default `1000`, `0` disables) per `RATE_LIMIT_WINDOW_MS` (default `60000`). Exceeding it returns `429` with `Retry-After` and `X-RateLimit-*` headers. `/health` and monitoring routes are not limited.
- This service is called by the BFFs, which currently do not forward the end-user address, so the client IP is the calling BFF pod and all its users share one bucket. The default is therefore generous; raise it if BFF traffic approaches it, or forward `X-Forwarded-For` from the BFF and set `TRUST_PROXY` to the BFF hops/CIDRs for per-user limits.
- The limiter state is per process: with N replicas the effective per-client budget is up to N times `RATE_LIMIT_MAX`.
