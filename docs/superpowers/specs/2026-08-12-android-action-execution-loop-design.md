# Android Action Execution Loop Design

## Goal

Complete the independent operating loop in the Android workspace:
deterministic diagnosis to action card, action card to execution, and execution
to a structured verification outcome. The mobile client exposes only transitions
already enforced by the API state machine.

This feature does not connect to POS, ERP, delivery platforms, or any other
restaurant system. It does not create business facts, infer execution results,
or use an AI model to classify outcomes.

## Scope

The Operations tab adds write controls for an existing action card according to
its current server-supplied status:

| Current status | Allowed client commands |
| --- | --- |
| `proposed` | Start execution; cancel |
| `in_progress` | Complete with an execution note; cancel |
| `completed` | Mark verified with one structured outcome |
| `verified` | Read-only |
| `cancelled` | Read-only |

The client does not render commands for any other state transition. The server
remains authoritative: a stale card or concurrently updated card may still be
rejected by the existing API state machine.

## Data Flow

`OperationsApi` gains one store-scoped `PATCH` endpoint for the existing
`/v1/stores/{storeId}/action-cards/{actionCardId}/status` route. The request has
only three public fields:

- `status`: one of the API action-card statuses;
- `executionNote`: supplied only when completing;
- `verificationOutcome`: supplied only when verifying.

`HttpOperationsRepository` maps the response to the existing public
`ActionCard` model. The model grows `executionNote` and `verificationOutcome`
so completed and verified cards can display the persisted result without
exposing infrastructure identifiers or raw import fields.

`OperationsViewModel.updateActionCard` sends the requested transition through
the repository. On success, it replaces just the matching action card in the
current list and clears any stale verification summary if that card changed.
On an expected or unexpected request failure, it preserves the previous action
list, selected summary, and prior action details while showing a neutral error.

## Interaction Design

Each action-card row remains compact and status-led:

- A proposed card has a primary start command and a secondary cancel command.
- An in-progress card has a completion command that opens an inline note field;
  the command is disabled until the note is nonblank and within the API's
  500-character limit.
- A completed card shows its saved execution note, a verification-summary
  command, and four labelled outcome choices: effective, ineffective, not
  executed, and insufficient data.
- A verified card shows its saved execution note and outcome. A cancelled card
  shows status only. Neither is editable.

While a command is in flight, all commands for that card are disabled. Other
cards remain viewable. User-entered notes are not logged, echoed in failure
messages, or stored locally beyond Compose state.

## Error Handling

The client uses the existing neutral `OperationsRequestException` mapping.
Validation and conflict responses display the same safe operations failure
message; no server detail, request body, host, card ID, or raw response is
shown. A cancellation propagates normally. A failed completion or verification
does not discard the draft note or existing server card state.

## Testing

Add focused JVM coverage for:

- Retrofit endpoint/multipart-free request contract and public response mapping;
- every permitted transition request shape;
- omission of execution note and outcome on transitions where they are invalid;
- successful list replacement and stale-summary clearing;
- failed updates retaining existing card and summary with a neutral error;
- UI helper/state mapping for the five card statuses, including no controls for
  terminal cards and a 500-character completion-note boundary.

Run API tests only if an API defect is identified; the server route and state
machine are already implemented. Complete Android Debug unit tests, Debug APK,
Release APK, and `git diff --check` before delivery.
