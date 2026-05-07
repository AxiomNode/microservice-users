# Architecture

Last updated: 2026-05-08.

## Purpose

This section documents the repository-local architecture of `microservice-users`.

## Runtime position

- Internal domain service for identity and gameplay analytics.
- Consumed by `bff-mobile` and `bff-backoffice`.
- Must not be exposed as a direct public API.

## Owned responsibilities

`microservice-users` owns the domain behavior for:

- authenticated user profile state
- gameplay event ingestion
- profile-oriented and leaderboard-oriented aggregate reads

This repository should remain the system of record for those concerns rather than delegating them to a BFF.

## Internal layering

The service is expected to maintain a standard internal separation between:

- transport or route handlers
- identity and gameplay service logic
- persistence and aggregation queries

## Dependency model

Primary infrastructure dependency:

- PostgreSQL

Primary application consumers:

- `bff-mobile`
- `bff-backoffice`

## Architectural constraints

- no public internet-facing surface
- no duplication of Firebase session semantics in downstream callers
- private-docs behavior remains part of the repository release contract

## Failure boundaries

- auth/session creation fails because Firebase credentials or runtime mode are wrong
- persistence or aggregate reads fail even though the HTTP process is healthy
- leaderboard or profile reads degrade independently from health and private-docs behavior

## When to update

Update this section when changing owned data responsibilities, BFF consumer boundaries, or service-internal layer structure.
