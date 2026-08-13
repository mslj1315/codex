import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { AuthenticationError, issueAccessToken, parseAccessToken } from "../src/auth/tokens.js";

describe("auth tokens", () => {
  const secret = "a sufficiently long test signing secret";
  const issuedAt = new Date("2026-08-12T00:00:00.000Z");

  it("round-trips only account and session identity", () => {
    const token = issueAccessToken({ accountId: "account_owner", sessionId: "session_1" }, secret, issuedAt);

    expect(parseAccessToken(token, secret, issuedAt)).toEqual({ accountId: "account_owner", sessionId: "session_1" });
  });

  it("rejects tampered and expired access tokens", () => {
    const token = issueAccessToken({ accountId: "account_owner", sessionId: "session_1" }, secret, issuedAt);

    expect(() => parseAccessToken(`${token}x`, secret, issuedAt)).toThrow(AuthenticationError);
    expect(() => parseAccessToken(token, secret, new Date("2026-08-12T00:16:00.000Z"))).toThrow(AuthenticationError);
  });

  it("rejects a token with an unsupported version", () => {
    const token = issueAccessToken({ accountId: "account_owner", sessionId: "session_1" }, secret, issuedAt);
    const [header, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    const unsupportedPayload = Buffer.from(JSON.stringify({ ...decoded, v: 2 })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`${header}.${unsupportedPayload}`).digest("base64url");

    expect(() => parseAccessToken([header, unsupportedPayload, signature].join("."), secret, issuedAt)).toThrow(AuthenticationError);
  });
});
