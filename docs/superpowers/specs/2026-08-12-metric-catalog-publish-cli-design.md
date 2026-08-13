# Metric Catalog Publish CLI Design

## Goal

Provide a service-provider-only command that publishes a validated new metric
catalog version from a local JSON manifest. Store clients remain read-only and
continue to receive only the published public catalog.

## Boundary

The command requires `DATABASE_URL` and a JSON file path. It creates a draft
from the current published catalog, upserts every definition in the manifest,
then publishes the draft through `MetricCatalogOperatorService`. It does not
add an HTTP mutation route, authenticate a store user, modify Android, or
integrate with a POS or other restaurant system.

## Input and Output

The manifest is a JSON array of the existing `MetricDefinition` shape. An
empty or malformed manifest is rejected before creating a database connection.
On success the command writes one JSON object containing only
`versionNumber` and `state: "published"`. On failure it writes a fixed
non-sensitive stderr message and exits nonzero.

## Safety

The existing repository remains the source of truth for identifier, unit,
domain, draft-state, and core-readiness validation. A failed upsert or publish
leaves the current published catalog unchanged because each repository method
uses its existing transaction boundary. The CLI will not print definitions,
database URLs, or error messages.

## Verification

Tests will cover invalid environment or manifest input, successful publication
of a new custom field, repository validation rejection without output leaks,
and database closure on success and failure. The API suite, TypeScript check,
and Compose configuration will be run before delivery.
