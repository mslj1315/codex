# Unified Admin, RBAC, Customer Provisioning, And Model Management Design

## Goal

Replace the separate provider and operator browser applications with one Chinese internal management console at `/admin/`. Give super administrators complete internal-console capability, allow configurable roles made from stable functional permissions, provision customer accounts by mobile number with one-time passwords, and manage encrypted server-side model configurations and customer model assignments without exposing client raw content or model secrets.

## Non-Negotiable Boundaries

- This is one internal console, not a merger of internal users with customer Android access.
- A `super_admin` can manage every internal-console page and operation, but cannot read customer inspirations, copy bodies, review records, storyboards, media, object addresses, raw prompts, or model secrets.
- Customer content/media routes remain customer-only. Internal service roles are rejected before any resource read, write, storage, render, or model invocation.
- Model API keys are accepted only over the authenticated admin API, encrypted before persistence using a server-environment master key, never returned in full, never put in Android/static bundles, and never logged/audited as plaintext.
- The first customer credential is a server-generated temporary password. Mobile number is the login identifier, not the password. First customer login must change the temporary password.

## Unified Console

The browser console is served under `/admin/`, with a single authenticated session and navigation derived from the caller's server-issued permission summary. The console contains these sections when the relevant functional permission exists:

1. Overview: operational aggregates, model aggregate usage, and safe health indicators.
2. Customer management: customer accounts, enterprise/store assignment, account status, temporary-password reset, and customer model assignment.
3. Content operations: templates, copy library, deterministic and AI review rule versions.
4. Model operations: model configurations, current default assignment, model price versions, customer overrides, and aggregate use/cost.
5. Access management: internal accounts, configurable roles, stable permissions, and audit records.

Existing `/provider/` and `/operator/` paths redirect to `/admin/` during transition. Their separately built browser applications are removed only after the new console has route, authorization, and migration coverage.

## RBAC

Roles have immutable machine permission codes and editable Chinese display metadata. An internal account may have multiple roles; effective permissions are their union. `super_admin` is server-recognized and has every defined internal permission even if roles are edited or removed.

Examples include:

- `customer_accounts.read`, `customer_accounts.create`, `customer_accounts.reset_password`, `customer_accounts.disable`
- `content_templates.read`, `content_templates.edit`, `content_templates.publish`
- `review_rules.read`, `review_rules.edit`, `review_rules.publish`
- `model_configs.read`, `model_configs.manage`, `model_assignments.manage`
- `model_pricing.read`, `model_pricing.manage`, `model_usage.read`
- `internal_accounts.read`, `internal_accounts.manage`, `roles.manage`, `audit.read`

Both frontend navigation and every API action use these same codes. UI hiding is ergonomic only; the API rejects missing permissions with 403 before repositories or external work execute.

## Customer Provisioning

An authorized internal user creates a customer account from a normalized Chinese mobile number, display name, enterprise ID, store ID, and initial store role. The server generates a high-entropy temporary password, stores only its bcrypt hash, returns the plaintext once in the create/reset response, and records a password-change-required marker. The Android login flow rejects normal workflow access until the password is changed. Reset invalidates the previous temporary/active credential session state.

Customer account creation does not make the creator a customer and never creates an internal role. Customer accounts cannot enter `/admin/`.

## Model Configuration And Assignment

A model configuration is an internal record with provider type, model identifier, HTTPS base URL, enabled state, safe display label, encrypted API key ciphertext, key fingerprint/suffix, and audit revision. The server master encryption key comes only from production environment configuration. Decrypt is allowed only within the server-side model execution adapter; no read endpoint includes ciphertext or plaintext.

Super administrators or accounts with `model_configs.manage` create, rotate, enable, disable, and select a default configuration. The assignment service resolves a customer-specific configuration first and otherwise uses the current default. Customers cannot choose models. Each generation run records only safe model identity and the existing token/cost snapshots; it never stores the raw key or prompt.

## Audit

Record actor, time, action code, target type/ID, allowed/succeeded outcome, and safe before/after metadata for role grants, account lifecycle, model configuration lifecycle, model assignment, price lifecycle, and content publication. Never record passwords, temporary passwords, API key plaintext/ciphertext, customer content, prompts, raw media, or object locations.

## Verification

- Route/DOM tests prove `/admin/` only shows allowed sections; legacy paths redirect.
- API authorization tests prove a permission denial occurs before data access; super admin covers every internal permission but customer resource routes still deny it.
- Account tests cover phone normalization, random one-time password, no password readback, forced first change, reset/session invalidation, and customer exclusion from admin routes.
- Model tests cover HTTPS URL validation, encryption/no-key-readback, rotation, default/customer assignment precedence, disabled model rejection, and no browser/Android key leakage.
- Full API, admin-console, Android authentication, typecheck, build, and diff checks run before completion.
