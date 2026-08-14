# Operator Content Console Design

## Purpose

Build the internal platform-operator console for maintaining the structured
content-template library and review rules used by restaurant content planning.
This is not a provider or customer console. It does not expose customer drafts,
raw Douyin reports, model credentials, training exports, media editing, or
publishing.

## Scope

This increment creates `apps/provider-console` as a React, Vite, and TypeScript
single-page application, plus the server-side account, session, role, and
versioned operator-content APIs it requires.

The console supports these roles:

- `operator_editor`: create, edit, and submit template/rule draft versions.
- `operator_reviewer`: review submitted versions, return them with a reason,
  publish them, and disable published versions.

Providers, customers, Android clients, unauthenticated callers, and callers
with the wrong operator role receive neutral forbidden responses. They do not
receive operator navigation or operator-content data.

## Authentication And Sessions

Operator users authenticate with an account ID and password. Passwords are
stored only as a modern one-way password hash. The server creates an expiring,
revocable HttpOnly, SameSite session cookie. Browser JavaScript never stores a
password, bearer token, model key, or raw customer data.

There is no self-service registration. A controlled CLI provisions initial
operator accounts and assigns either editor or reviewer role. Disabling an
account invalidates its active sessions. Logout revokes the current session.

All state-changing console requests require the authenticated session, a
same-origin request, and a CSRF token bound to that session. API handlers
validate request bodies before use and return neutral errors for invalid,
unauthenticated, or unauthorized requests.

## Versioned Content Model

Templates and rules use the same three-part persistence model:

1. A logical item gives the stable business identity.
2. A version record stores one immutable version of that item.
3. An audit event records submit, return, publish, disable, and related actor,
   role, time, reason, and version information.

Creating a new draft or modifying a draft creates or updates the current draft
version. A published version is never modified in place. Updating a published
item starts its next draft version; past content-generation records retain the
actual version IDs used. Published and used version records, together with
audit events, are protected against update and delete at the database level.

Lifecycle states are `draft`, `submitted`, `returned`, `published`, and
`disabled`. Editor actions are limited to draft and submitted transitions.
Reviewer actions are limited to return, publish, and disable. A returned
version can be edited by the editor and resubmitted. Only `published` versions
participate in template matching and review-rule selection.

## Template And Rule Fields

A structured template version contains:

- hook, story progression, emotional/value point, product appearance, CTA;
- shot rhythm, caption and voice requirements, prohibited expressions;
- industry, category, persona, content type, commercial level, and style
  constraints;
- fallback scope, price/discount/effect restrictions, and risk level.

A rule version contains:

- literal absolute-word patterns and semantic categories;
- severity, platform, scope, and customer-facing guidance;
- editor and reviewer audit fields plus lifecycle status.

Rules provide a server-side test-preview endpoint. Preview input is transient:
it is not retained as a template, customer draft, training input, or export.

## Console Information Architecture

The application is a work-focused console, not a marketing page.

```text
Sign in
  -> Template library
      -> list, filters, version detail, draft editor, submit
  -> Review rules
      -> list, filters, version detail, rule editor, test preview, submit
  -> Review inbox
      -> return with reason, publish, disable
```

Editors see template and rule authoring flows. Reviewers see the review inbox
and published-version views. The UI uses role-derived capability flags from
the session response, not caller-supplied role values. It renders content as
ordinary text and never uses unsafe HTML.

Templates and rules are edited in an unframed full-width work area with a
compact navigation rail and scan-friendly lists. The page has explicit
loading, empty, conflict, forbidden, expired-session, retry, and success
states. It does not expose customer/profile data, raw reports, training data,
media upload, render, caption, transition, or platform-publishing controls.

## Production Boundaries

The console sends only same-origin requests to a method-and-path allowlist.
It does not accept arbitrary API URLs or caller-provided authorization headers.
The server does not return raw passwords, password hashes, session secrets,
model keys, customer raw data, or unconfirmed customer content.

No restaurant POS, restaurant-system integration, Douyin account linking,
automatic data synchronization, video editing, rendering, or publishing is
added by this increment. Existing Android authentication and existing import
API contracts remain unchanged.

## Verification

API tests prove account/session lifecycle, CSRF enforcement, editor/reviewer
authorization, neutral provider forbidden responses, version increments,
published immutability, return reasons, disabling, published-only selection,
rule preview, and malformed-input handling. Migration tests exercise full
migration order and PostgreSQL append-only triggers where supported.

Console tests prove login/logout/session expiry, role-gated navigation,
draft/submit/review flows, safe text rendering, request allowlisting, CSRF
handling, and error states. Completion requires API and console full tests,
typechecks, console production build, Android regression checks where the SDK
is available, and `git diff --check`. The work stops before push or deploy.
