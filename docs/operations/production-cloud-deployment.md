# Production Cloud Deployment

This runbook deploys the Restaurant Ops API and its two internal static consoles at `https://app.msljkj.cn`. It deliberately keeps PostgreSQL private, preserves the existing unrelated `bot.msljkj.cn` Nginx site, and leaves all video/object-storage work disabled.

## Server Preparation

On the server, keep a dedicated checkout at `/opt/restaurant-ops`. Permit only SSH, HTTP, and HTTPS through the host firewall (ports 22, 80, and 443). Docker Engine with Docker Compose v2, Nginx, Certbot, OpenSSL, and curl must be installed before the first deployment.

Clone or update the intended reviewed source revision into `/opt/restaurant-ops`; do not run the production procedure from a personal home directory or an unreviewed archive. Before changing Nginx, inspect its complete configuration and preserve the separate `bot.msljkj.cn` configuration untouched.

```sh
cd /opt/restaurant-ops
git status --short
git rev-parse HEAD
sudo nginx -T
```

Verify that `app.msljkj.cn` resolves to the target server before requesting a certificate. Do **not** install the final TLS configuration yet: it references certificate files that do not exist before issuance, so `nginx -t` would fail. First install a separate HTTP-only bootstrap virtual host for the ACME webroot. It must not proxy the API and must not alter the separate `bot.msljkj.cn` virtual host.

```sh
getent hosts app.msljkj.cn
sudo install -d -m 0755 /var/www/certbot
sudo tee /etc/nginx/conf.d/app.msljkj.cn.bootstrap.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name app.msljkj.cn;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 404;
    }
}
EOF
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d app.msljkj.cn
```

Only after certificate issuance succeeds, remove the bootstrap file and install `deploy/production/nginx/app.msljkj.cn.conf` as the final virtual host. The final host only proxies the API loopback address and must never expose PostgreSQL, MinIO, object storage, or a model gateway.

```sh
sudo rm /etc/nginx/conf.d/app.msljkj.cn.bootstrap.conf
sudo install -m 0644 /opt/restaurant-ops/deploy/production/nginx/app.msljkj.cn.conf \
  /etc/nginx/conf.d/app.msljkj.cn.conf
sudo nginx -t
sudo systemctl reload nginx
```

Certbot must run only after the DNS check succeeds. Its certificate paths in the final app site configuration are specific to `app.msljkj.cn`; do not replace certificates or Nginx files belonging to `bot.msljkj.cn`.

## Server-Only Environment

Create `deploy/production/.env` directly on the server. Start with the tracked `.env.example`, use root ownership, and keep it inaccessible to application users, frontends, Android artifacts, Nginx, source control, and chat transcripts.

```sh
cd /opt/restaurant-ops/deploy/production
umask 077
cp .env.example .env
AUTH_TOKEN_SECRET_VALUE="$(openssl rand -hex 48)"
POSTGRES_PASSWORD_VALUE="$(openssl rand -hex 32)"
chmod 600 .env
```

Set `AUTH_TOKEN_SECRET` to `AUTH_TOKEN_SECRET_VALUE` and use the distinct hexadecimal `POSTGRES_PASSWORD_VALUE` consistently for `POSTGRES_PASSWORD` and the password segment of `DATABASE_URL`. Hexadecimal values are URI-safe; if a different password format is used, percent-encode its password segment before writing `DATABASE_URL`. Remove the shell variables when finished and do not print the file:

```sh
unset AUTH_TOKEN_SECRET_VALUE POSTGRES_PASSWORD_VALUE
stat -c '%a %U:%G %n' .env
```

For the approved Responses-compatible gateway, set `MODEL_PROVIDER=openai_responses`, its approved `MODEL_MODEL`, HTTPS `MODEL_BASE_URL`, and a newly rotated `MODEL_API_KEY` in this server-local file only. The API explicitly opts out of provider-side response storage. Do not put a model key in Android, either browser console, an APK, Nginx, repository files, logs, or support messages. A previous key shared outside this environment must be rotated before launch.

The Compose contract fixes `OPERATOR_PUBLIC_ORIGIN=https://app.msljkj.cn` and `OPERATOR_COOKIE_SECURE=true`; do not override either in the production `.env`. Keep `VIDEO_STORAGE_MODE=disabled`. This release does not connect a POS, does not enable object storage/FFmpeg uploads, and does not publish to Douyin automatically.

## Deploy And Verify

The guarded release script checks required values, runs migrations through the API service command, builds the current image, starts private Compose services, and polls the local health endpoint. It intentionally does not generate secrets, provision users, call the model, or contact Douyin.

```sh
cd /opt/restaurant-ops
sh deploy/production/scripts/deploy.sh
cd deploy/production
docker compose --env-file .env -f compose.yml ps
curl --fail https://app.msljkj.cn/health
```

Record the reviewed Git revision, image digest, migration output, service status, and HTTP status codes in an access-controlled operations log that contains no credentials. Confirm the migration sequence includes the current pricing/usage schema before onboarding. For troubleshooting, use targeted, redacted `docker compose ... logs --tail 100 api`; never dump container environments or `.env`.

## Initial Accounts And Model Pricing

Provision a customer only using the API's controlled account command with credentials supplied through server-local environment variables. Do not place passwords in shell history or source files. Set `CUSTOMER_PASSWORD` in the current protected shell, choose that customer's existing enterprise and store identifiers, run the command, then unset it.

```sh
cd /opt/restaurant-ops/deploy/production
docker compose --env-file .env -f compose.yml exec -T \
  -e PROVISION_LOGIN_NAME=customer_test \
  -e PROVISION_DISPLAY_NAME='Customer Test' \
  -e PROVISION_PASSWORD="$CUSTOMER_PASSWORD" \
  -e PROVISION_ENTERPRISE_ID="$CUSTOMER_ENTERPRISE_ID" \
  -e PROVISION_STORE_ID="$CUSTOMER_STORE_ID" \
  -e PROVISION_STORE_ROLE=owner \
  api npm run provision:account
unset CUSTOMER_PASSWORD
```

Grant the narrowly scoped `model_pricing_operator` role only to a dedicated internal service-provider operator. Bootstrap that distinct account with the same provision command using the explicit internal-only membership `PROVISION_ENTERPRISE_ID=internal_service_enterprise` and `PROVISION_STORE_ID=internal_service_store` with `PROVISION_STORE_ROLE=operator`; these identifiers are reserved for internal service operations and are not a real customer enterprise or store. Use a separate `PROVISION_LOGIN_NAME`, `PROVISION_DISPLAY_NAME`, and `PROVISION_PASSWORD` for this account. The account must never receive a membership for any customer enterprise or store.

After the provisioning command returns its `accountId`, set that returned identifier only in the current protected shell and grant the role. The role is for aggregate price and usage administration; it must not grant customer content, inspirations, drafts, review records, storyboards, raw media, source URLs, or object-address access.

```sh
docker compose --env-file .env -f compose.yml exec -T \
  -e PROVISION_LOGIN_NAME=pricing_operator \
  -e PROVISION_DISPLAY_NAME='Model Pricing Operator' \
  -e PROVISION_PASSWORD="$PRICING_OPERATOR_PASSWORD" \
  -e PROVISION_ENTERPRISE_ID=internal_service_enterprise \
  -e PROVISION_STORE_ID=internal_service_store \
  -e PROVISION_STORE_ROLE=operator \
  api npm run provision:account

docker compose --env-file .env -f compose.yml exec -T \
  -e GRANT_ACCOUNT_ID="$PRICING_OPERATOR_ACCOUNT_ID" \
  -e GRANT_SERVICE_OPERATOR_ROLE=model_pricing_operator \
  api npm run grant:service-role
unset PRICING_OPERATOR_PASSWORD PRICING_OPERATOR_ACCOUNT_ID
```

Sign in to the provider console as that dedicated operator, create a price draft with CNY per one million input and output tokens, review it, then publish it. Published prices remain historical snapshots; later changes need a new draft. The provider console may display only authorized aggregate feedback and aggregate model-pricing data, never customer-level activity.

## Backup, Rollback, And Maintenance

Take a PostgreSQL volume backup before schema-affecting releases and keep the encrypted archive outside the server's Docker volume. Test restores in an isolated environment before relying on them. A basic backup uses a short-lived container on the private Compose network:

```sh
cd /opt/restaurant-ops/deploy/production
docker compose --env-file .env -f compose.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > /root/restaurant-ops-backup-YYYYMMDD.sql
```

The shell receiving the backup must use restrictive permissions. Restore only after stopping the API, reviewing the target database, and testing the command against a disposable copy; a restore overwrites data and requires an explicit change decision.

For a rollback, retain the prior reviewed Git revision and image digest. Check out that revision, confirm its migration compatibility with the live database, then run the same deploy script. Database migrations are forward-only unless a reviewed recovery procedure says otherwise; do not delete volumes, run `docker system prune`, or roll back an image blindly. Capture the rollback reason and resulting health status.

Schedule a recurring encrypted database backup, a restore exercise, certificate renewal verification, image/security review, and health checks. Keep import/video cleanup or rendering workers off this production topology until the separately reviewed protected object-storage signer and FFmpeg worker deployment exists. Review model price changes and aggregate usage routinely without expanding service-provider access.
