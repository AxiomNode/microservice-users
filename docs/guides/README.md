# Guides

Last updated: 2026-05-03.

## Scope

This section groups repository-local guidance for integrating with `microservice-users` safely.

## Integration rules

- consumers should treat this service as private and BFF-facing
- auth behavior must be explicit: Firebase token in normal mode, dev UID only in allowed fallback mode
- profile, stats, and leaderboard contracts should evolve in sync with shared contract definitions when applicable

## Intended topics

- internal BFF integration
- versioned contract usage from `contracts-and-schemas`
- auth and profile/leaderboard consumer expectations

## Consumer checklist

Before changing a consumer integration, verify:

1. whether the consumer is mobile-facing or backoffice-facing
2. whether auth headers are forwarded correctly
3. whether the change affects leaderboard semantics or profile reads
4. whether private-docs behavior or internal monitoring paths are part of the release safety net
