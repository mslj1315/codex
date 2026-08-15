# OpenAI Responses Model Provider Design

## Purpose

Add a server-only, OpenAI Responses-compatible model provider for restaurant
content generation and semantic review. The initial deployment targets the
configured third-party HTTPS gateway at `https://hk.claudecodes.org/v1` with
the configured model `gpt-5.6-terra-openai-compact`.

## Scope

- Add provider ID `openai_responses` to the API model-provider boundary.
- Send structured generation requests to `POST {MODEL_BASE_URL}/responses`.
- Require an HTTPS base URL and normalize a trailing slash before appending
  `/responses`.
- Request structured JSON through Responses API text formatting and set
  `store: false` on every request.
- Parse only final structured text and allowed token usage fields.
- Reuse existing timeout, retry, schema validation, generation audit, and
  customer-only content workflow behavior.
- Document server-only production environment variables.

## Explicit Non-Goals

- No Android, provider-console, operator-console, or client-side key access.
- No OpenAI tools, browsing, files, background jobs, streaming, or automatic
  Douyin publishing.
- No persistence of an API key, raw prompt, customer copy body, or raw
  Responses response object in model/audit records.
- No automatic rollout using a key supplied in chat; deployment uses a newly
  generated key entered locally on the server.

## Request And Response Boundary

The provider sends an HTTPS request with a bearer authorization header and
the configured model. It encodes the existing structured prompt payload as
one Responses input message and requires JSON output. The request always sets
`store: false`.

The adapter accepts a completed response containing a final output text value
that parses as JSON. It maps `input_tokens`, `output_tokens`, and
`total_tokens` when present and valid. Missing or malformed structured text,
usage values, HTTP failures, and invalid JSON become existing neutral model
provider errors. They do not expose the gateway response body to a customer or
any console.

## Configuration

```text
MODEL_PROVIDER=openai_responses
MODEL_MODEL=gpt-5.6-terra-openai-compact
MODEL_BASE_URL=https://hk.claudecodes.org/v1
MODEL_API_KEY=<server-only secret>
MODEL_TIMEOUT_MS=15000
MODEL_MAX_RETRIES=1
```

`MODEL_BASE_URL` is the gateway root, not the complete `/responses` endpoint.
The production environment must not enable local container development mode.

## Token Pricing And Usage Aggregation

Token prices are configured in CNY per one million tokens. Each immutable,
published price version has separate non-negative input and output prices,
provider, model, effective time, and optional retirement time. A new price is
published as a new version; published history is never edited.

When a generation run succeeds, the server selects the applicable published
price version and freezes its ID, currency, input price, output price, input
cost, output cost, and total cost beside the existing usage record. A missing
price does not block generation: the usage remains cost-unpriced. Later price
changes never recalculate historical runs.

The internal service-provider console may create and publish price versions
and see only date/provider/model aggregate usage and cost. It cannot query a
customer, task, generation run, prompt, copy, review, storyboard, media, or
object address. Customers may see only their own enterprise/store aggregate
usage and estimated cost. The price-configuring role receives no customer data
read capability as a consequence of configuring prices.

## Verification

Tests first prove request method, URL normalization, authorization header,
`store: false`, structured request body, successful output/usage mapping, and
neutral handling of malformed Responses output, timeouts, and retryable
gateway failures. Existing content workflow and full API tests must remain
green. A post-deploy health check uses a newly generated key and a synthetic
non-customer prompt only; it must not send a customer profile, inspiration, or
copy to validate gateway capability.
