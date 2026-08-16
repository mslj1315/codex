# Douyin Official Data Connection Design

## Goal

Replace customer-uploaded CSV/XLSX reports as the primary Douyin feedback path with server-side collection through authorised Douyin official capabilities. The first release supports separate, incremental connections for content-account performance data and life-service store/group-buy conversion data.

The feature must associate an officially published work with one content task without automatically publishing video, editing video, uploading media, storing a Douyin password, or exposing official credentials to clients.

## Scope And Boundaries

- The content account connection provides only the officially authorised work and content-performance metrics, such as plays, completion, likes, comments, shares, and favourites.
- The life-service store connection provides only the officially authorised group-buy and conversion metrics, such as POI/product clicks, coupon claims, orders, GMV, redemptions, and redeemed GMV.
- A store can connect either type first and can add the other later. The UI must state unavailable metric groups instead of treating them as zero.
- OAuth tokens, refresh tokens, client secrets, and raw provider responses remain server-only. Tokens are encrypted at rest.
- Providers may only read confirmed aggregate results for assigned stores, split by content task and group-buy product. They must never read orders, consumer data, raw Douyin responses, tokens, or other stores' data.
- Model prompts and model logs must not receive raw official responses, order-level data, or credentials.
- Existing Android authentication and API contracts remain unchanged.
- The release does not implement automatic publishing, media upload, video editing, external-account password storage, POS integration, or third-party platform scraping.

## Connections And OAuth

Create a server-side `DouyinDataConnection` for one `(enterprise_id, store_id, connection_type)`.

`content_account` represents an authorised enterprise/creator account. `life_service_store` represents an authorised life-service merchant/store. A connection records its official subject identifier, granted scopes/capabilities, encrypted access and refresh token material, expiry, current state, and non-sensitive diagnostic category.

Starting OAuth creates a short-lived, single-use server record containing the authenticated enterprise/store scope, requested connection type, redirect target, nonce, and expiry. The callback validates and consumes this state before token exchange. No browser-controlled store identifier is trusted after redirect.

Before expiry, the server may use the official refresh flow. Repeated syncs stop immediately when refresh or collection reports revocation, invalid authorisation, or a non-retryable permission failure. The connection becomes `reauthorization_required`; historical snapshots remain available. Clients receive only the state, capability summary, last success time, retry eligibility, and neutral failure category.

## Publishing Association

After a content task's shot list is confirmed, the customer can start a publish-association session and open the official Douyin publishing or work flow. The customer completes publishing in Douyin; the system does not publish on their behalf.

Association precedence is:

1. Bind automatically when an official publish result or authorised work query identifies the work ID.
2. Otherwise, let the customer select an item from the authorised account's recent works.
3. If authorised work listing is unavailable, accept a pasted work link, parse it server-side, and validate it against an authorised connection before binding.

Each association stores the content task, official work ID, connection version, association method (`official_callback`, `official_selection`, or `verified_link`), actor, and timestamp. The system never infers association from publication time alone.

## Sync And Snapshots

The server runs one daily sync per active connection. A customer can request an additional refresh at most once every six hours for each `(store, connection)` pair. A connection-level lock and idempotency key prevent overlapping daily and manual runs from duplicating or overwriting observations.

Only timeout, transport, rate-limit, and selected upstream 5xx failures receive bounded retries. Credential, scope, request, and response-shape failures stop without blind retry.

Raw provider payloads are parsed transiently into normalised observations. They are not exposed by application APIs. Each normalised metric records source connection, work/task/product linkage where available, collection time, source range, source availability, and a missing/unavailable reason when applicable.

Observations remain mutable only during the active measurement window. At the end of a task's selected 3, 7, or 14 day period, the system writes an immutable aggregate period snapshot. Missing or unauthorised metrics remain `unavailable`; the implementation must never convert missing values into zero.

## Customer And Provider Experience

Customer screens include separate cards for content-account and life-service-store connections. Each card shows connection state, actual capability summary, last successful sync, reauthorisation action where needed, and the next permitted manual refresh time.

An associated content task shows its association method, work state, available 3/7/14 day windows, content performance, group-buy conversion, operating-goal result, data completeness, and last sync. A missing group produces a clear availability state, not a negative conclusion.

The provider view is read-only and only renders confirmed aggregate results for assigned stores. It can compare content tasks and group-buy products but has no OAuth, manual refresh, work selection, raw-data, order, consumer, or credential capability.

## Migration From Manual Imports

CSV/XLSX feedback imports no longer appear in the normal customer workflow. They remain an administrator-enabled migration fallback, disabled by default. Manual snapshots are labelled `manual_import`; official snapshots are labelled `douyin_official`.

The system must reject or explicitly resolve a conflicting source for the same task and measurement period. It must never silently merge, overwrite, or use both sources as if they were one measurement series. Removing the fallback requires a separate product decision after official collection is stable.

## Testing And Verification

Tests must cover:

- OAuth state enterprise/store binding, expiry, single use, callback validation, encrypted-token persistence, refresh, revocation, and neutral client errors.
- Separate account/store capabilities, daily idempotency, connection locking, and six-hour manual refresh throttling.
- Official callback association, work-list selection, verified link fallback, and prohibition of timestamp-only association.
- Metric normalisation, unavailable-not-zero semantics, immutable 3/7/14 period snapshots, and manual/official source conflicts.
- Provider authorisation proving only confirmed aggregate task/product data is visible for assigned stores; raw responses, orders, consumers, credentials, and cross-store data are denied.
- Contract checks proving Android authentication and existing provider-feedback aggregate routes remain unchanged.

Before release, validate the exact authorised API surfaces, callback fields, token lifecycle, metric names, scopes, rate limits, and data retention terms against the Douyin official documentation and the approved developer/service-provider capability package. If an official capability does not return a work ID, the implementation uses official work selection or verified-link fallback rather than claiming automatic association.
