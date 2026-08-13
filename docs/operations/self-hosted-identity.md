# Self-Hosted Identity Operations

## Production Configuration

Set a unique high-entropy `AUTH_TOKEN_SECRET` for every production deployment.
The API refuses to start with a database unless this secret is present or an
explicit development context mode is selected. Terminate TLS before accepting
passwords or bearer tokens; do not send either across an unencrypted public
connection.

`LOCAL_CONTAINER_DEVELOPMENT_MODE=true` remains an explicit local demonstration
mode. It creates the fixed demo trusted context and must not be set in a
production deployment.

## Provision An Initial Account

There is no public sign-up route. Run the following from `services/api` with a
database URL that points to the intended deployment:

```powershell
$env:DATABASE_URL='postgresql://...'
$env:PROVISION_LOGIN_NAME='owner'
$env:PROVISION_DISPLAY_NAME='门店负责人'
$env:PROVISION_PASSWORD='use-a-unique-long-password'
$env:PROVISION_ENTERPRISE_ID='ent_example'
$env:PROVISION_STORE_ID='store_example'
$env:PROVISION_STORE_ROLE='owner'
npm run provision:account
```

The command creates or updates the named account and grants the specified store
membership in one database transaction. It prints one JSON summary containing
only the account ID and grant booleans. It never prints the password, password
hash, access token, refresh token, or signing secret.

To grant one independent service-provider capability during the same controlled
operation, set `PROVISION_SERVICE_OPERATOR_ROLE` to
`metric_catalog_operator`, `provider_feedback_viewer`, or
`provider_customer_metadata_editor`. This does not grant the account access to
any store route. Do not add this variable for ordinary store users.

## Grant An Existing Provider Account A Role

Use `grant:service-role` for an existing account. It grants one exact
service-provider role without changing credentials, store memberships, or
sessions. Metadata writes require both the feedback-viewer and metadata-editor
roles; grant each role explicitly:

```powershell
$env:DATABASE_URL='postgresql://...'
$env:GRANT_ACCOUNT_ID='account_example'
$env:GRANT_SERVICE_OPERATOR_ROLE='provider_feedback_viewer'
npm run grant:service-role

$env:GRANT_SERVICE_OPERATOR_ROLE='provider_customer_metadata_editor'
npm run grant:service-role
```

The command does not grant store access and must not be used as a shortcut for
store membership. A metadata-editor role on its own has no provider-feedback
visibility.

## Token Lifecycle

Login returns a 15-minute access token and a 30-day refresh token. Refreshing
rotates the session, so replaying the old refresh token fails. Logout revokes
the current session and invalidates its access token before expiry. Rotating
`AUTH_TOKEN_SECRET` invalidates all access tokens; revoke or re-provision
sessions as part of the same incident response.

The API derives enterprise, store, and actor context from the bearer account's
enabled membership. Clients must not send tenant or actor headers to select a
scope; they are ignored by the business routes.
