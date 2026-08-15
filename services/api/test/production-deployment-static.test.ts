import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const productionCompose = new URL("../../../deploy/production/compose.yml", import.meta.url);
const productionEnvironment = new URL("../../../deploy/production/.env.example", import.meta.url);
const nginxConfiguration = new URL("../../../deploy/production/nginx/app.msljkj.cn.conf", import.meta.url);
const deploymentScript = new URL("../../../deploy/production/scripts/deploy.sh", import.meta.url);
const productionRunbook = new URL("../../../docs/operations/production-cloud-deployment.md", import.meta.url);
const execFileAsync = promisify(execFile);

describe("production deployment topology", () => {
  it("keeps the API private behind host Nginx and disables video storage", async () => {
    const compose = await readFile(productionCompose, "utf8");

    expect(compose).not.toContain("LOCAL_CONTAINER_DEVELOPMENT_MODE");
    expect(compose).not.toContain("DEVELOPMENT_MODE");
    expect(compose).not.toContain("minio");
    expect(compose).not.toContain("MINIO_");
    expect(compose).toContain('"127.0.0.1:3000:3000"');
    expect(compose).toContain("VIDEO_STORAGE_MODE: disabled");
    expect(compose).toContain("AUTH_TOKEN_SECRET");
    expect(compose).toContain("DATABASE_URL");
    expect(compose).toContain("DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}");
    expect(compose).not.toContain("POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@postgres");
    expect(compose).toContain("OPERATOR_PUBLIC_ORIGIN: https://app.msljkj.cn");
    expect(compose).toContain("OPERATOR_COOKIE_SECURE: \"true\"");
    expect(compose).not.toMatch(/^\s*-\s*["']?\d+:5432/m);
    expect(compose).not.toMatch(/^\s*-\s*["']?\d+:900[01]/m);
  });

  it("uses documented non-secret placeholders for production-only values", async () => {
    const environment = await readFile(productionEnvironment, "utf8");

    expect(environment).toContain("AUTH_TOKEN_SECRET=REPLACE_WITH_GENERATED_SECRET");
    expect(environment).toContain("DATABASE_URL=postgresql://restaurant_ops:REPLACE_WITH_PERCENT_SAFE_DATABASE_PASSWORD@postgres:5432/restaurant_ops");
    expect(environment).toContain("# MODEL_PROVIDER=openai_responses");
    expect(environment).toContain("# MODEL_MODEL=REPLACE_WITH_APPROVED_MODEL_ID");
    expect(environment).toContain("# MODEL_API_KEY=REPLACE_WITH_SERVER_ONLY_GATEWAY_KEY");
    expect(environment).toContain("# MODEL_BASE_URL=https://gateway.example/v1");
    expect(environment).toContain("VIDEO_STORAGE_MODE=disabled");
    expect(environment).not.toContain("OPERATOR_PUBLIC_ORIGIN=");
    expect(environment).not.toContain("OPERATOR_COOKIE_SECURE=");
    expect(environment).not.toContain("LOCAL_CONTAINER_DEVELOPMENT_MODE");
    expect(environment).not.toContain("DEVELOPMENT_MODE");
    expect(environment).not.toContain("MINIO_");
  });

  it("redirects HTTP to HTTPS and proxies only the API origin", async () => {
    const nginx = await readFile(nginxConfiguration, "utf8");

    expect(nginx).toContain("server_name app.msljkj.cn");
    expect(nginx).toContain("return 301 https://$host$request_uri");
    expect(nginx).toContain("listen 443 ssl");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000");
    expect(nginx).toContain("proxy_set_header Host $host");
    expect(nginx).not.toContain("proxy_set_header Origin");
    expect(nginx).not.toContain("minio");
    expect(nginx).not.toContain(":5432");
    expect(nginx).not.toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for");
  });

  it("resolves only the API loopback port in Docker Compose", async () => {
    let output: string;
    try {
      ({ stdout: output } = await execFileAsync("docker", ["compose", "--env-file", ".env.example", "config", "--format", "json"], {
        cwd: fileURLToPath(new URL("../../../deploy/production", import.meta.url))
      }));
    } catch (error) {
      if (isDockerUnavailable(error)) return;
      throw error;
    }

    const config = JSON.parse(output) as { services: Record<string, { ports?: Array<{ host_ip?: string; published?: string; target?: number }> }> };
    expect(config.services.postgres.ports).toBeUndefined();
    expect(config.services.api.ports).toEqual([{ mode: "ingress", host_ip: "127.0.0.1", target: 3000, published: "3000", protocol: "tcp" }]);
  });

  it("uses a guarded local release script without printing or creating secrets", async () => {
    const script = await readFile(deploymentScript, "utf8");

    expect(script).toContain("set -eu");
    expect(script).toContain("[ ! -f .env ]");
    expect(script).toContain("[ ! -e ../../.git ]");
    expect(script).toContain("AUTH_TOKEN_SECRET");
    expect(script).toContain("POSTGRES_DB");
    expect(script).toContain("POSTGRES_USER");
    expect(script).toContain("POSTGRES_PASSWORD");
    expect(script).toContain("DATABASE_URL");
    expect(script).not.toContain("require_env MODEL_PROVIDER");
    expect(script).toContain('MODEL_PROVIDER:-}');
    expect(script).toContain('= "openai_responses"');
    expect(script).toContain("require_env MODEL_MODEL");
    expect(script).toContain("require_env MODEL_API_KEY");
    expect(script).toContain("require_env MODEL_BASE_URL");
    expect(script).toContain("docker compose --env-file .env -f compose.yml up -d --build");
    expect(script).toContain("http://127.0.0.1:3000/health");
    expect(script).not.toContain("cat .env");
    expect(script).not.toContain("curl | sh");
    expect(script).not.toContain("--privileged");
    expect(script).not.toContain("docker system prune");
  });

  it("allows a model-free base deployment without injecting empty model variables", async () => {
    const compose = await readFile(productionCompose, "utf8");

    expect(compose).toContain("env_file:\n      - path: .env\n        required: false");
    expect(compose).not.toContain("MODEL_PROVIDER: ${MODEL_PROVIDER:?MODEL_PROVIDER is required}");
    expect(compose).not.toContain("MODEL_MODEL: ${MODEL_MODEL:?MODEL_MODEL is required}");
    expect(compose).not.toContain("MODEL_API_KEY: ${MODEL_API_KEY:?MODEL_API_KEY is required}");
    expect(compose).not.toContain("MODEL_BASE_URL: ${MODEL_BASE_URL:?MODEL_BASE_URL is required}");
  });

  it("documents root-only secrets, controlled onboarding, recovery, and disabled video", async () => {
    const runbook = await readFile(productionRunbook, "utf8");

    expect(runbook).toContain("/opt/restaurant-ops");
    expect(runbook).toContain("umask 077");
    expect(runbook).toContain("chmod 600 .env");
    expect(runbook).toContain("openssl rand -hex 48");
    expect(runbook).toContain("DATABASE_URL");
    expect(runbook).toContain("bot.msljkj.cn");
    expect(runbook).toContain("app.msljkj.cn");
    expect(runbook).toContain("certbot");
    expect(runbook).toContain("HTTP-only bootstrap");
    expect(runbook).toContain("certbot certonly --webroot");
    expect(runbook).toContain("after certificate issuance");
    expect(runbook).toContain("provision:account");
    expect(runbook).toContain("PROVISION_LOGIN_NAME");
    expect(runbook).toContain("PROVISION_DISPLAY_NAME");
    expect(runbook).toContain("PROVISION_PASSWORD");
    expect(runbook).toContain("PROVISION_ENTERPRISE_ID");
    expect(runbook).toContain("PROVISION_STORE_ID");
    expect(runbook).toContain("PROVISION_STORE_ROLE");
    expect(runbook).toContain("model_pricing_operator");
    expect(runbook).toContain("grant:service-role");
    expect(runbook).toContain("GRANT_ACCOUNT_ID");
    expect(runbook).toContain("GRANT_SERVICE_OPERATOR_ROLE");
    expect(runbook).toContain("internal_service_enterprise");
    expect(runbook).toContain("internal_service_store");
    expect(runbook).toContain("must never receive a membership for any customer enterprise or store");
    expect(runbook).not.toMatch(/-e ACCOUNT_ID=/);
    expect(runbook).not.toMatch(/-e ACCOUNT_PASSWORD=/);
    expect(runbook).not.toMatch(/-e SERVICE_ROLE=/);
    expect(runbook).toContain("backup");
    expect(runbook).toContain("rollback");
    expect(runbook).toContain("VIDEO_STORAGE_MODE=disabled");
    expect(runbook).toContain("does not publish to Douyin automatically");
    expect(runbook).not.toContain("MODEL_API_KEY=sk-");
  });
});

function isDockerUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
