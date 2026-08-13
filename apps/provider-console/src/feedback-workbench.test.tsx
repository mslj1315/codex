import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProviderApiClient } from "./api";
import { parseFeedbackPage, replaceProviderCustomerMetadata } from "./feedback";
import { FeedbackWorkbench } from "./feedback-workbench";

const sensitiveSentinels = [
  "sentinel-raw-import",
  "sentinel-fact-value",
  "sentinel-metric-value",
  "sentinel-file.csv",
  "sentinel-checksum",
  "sentinel-object-key",
  "sentinel-evidence",
  "sentinel-action-title",
  "sentinel-action-content",
  "sentinel-execution-note",
  "sentinel-contact"
];

describe("feedback response mapping", () => {
  it("copies only permitted aggregate and metadata fields and discards sensitive response fields", () => {
    const page = parseFeedbackPage(pagePayload([feedbackRow("ent-alpha", "store-1")]));

    expect(page).toEqual({
      items: [{
        feedback: {
          enterpriseId: "ent-alpha",
          storeId: "store-1",
          lastSuccessfulImportAt: "2026-08-12T08:00:00.000Z",
          lastConfirmedAt: "2026-08-12T09:00:00.000Z",
          lastCoverageAt: "2026-08-12T09:00:00.000Z",
          activityState: "active",
          readinessState: "ready",
          missingMetricCount: 0,
          diagnosticCounts: { revenue_decline: 2 },
          actionCardStatusCounts: { proposed: 1, verified: 3 },
          verificationOutcomeCounts: { effective: 2, data_insufficient: 1 }
        },
        metadata: {
          customerAlias: "Pilot",
          providerNote: "Internal note",
          version: 2,
          updatedAt: "2026-08-13T02:00:00.000Z"
        }
      }],
      nextCursor: "opaque+/=cursor"
    });
    expect(JSON.stringify(page)).not.toMatch(/sentinel-/);
  });

  it("rejects malformed or unknown aggregate values", () => {
    expect(() => parseFeedbackPage(pagePayload([{ feedback: { ...feedbackRow("ent", "store"), activityState: "paused" }, metadata: null }]))).toThrow("Invalid feedback response");
    expect(() => parseFeedbackPage(pagePayload([{ feedback: { ...feedbackRow("ent", "store"), missingMetricCount: -1 }, metadata: null }]))).toThrow("Invalid feedback response");
    expect(() => parseFeedbackPage(pagePayload([{ feedback: { ...feedbackRow("ent", "store"), diagnosticCounts: { secret_kind: 2 } }, metadata: null }]))).toThrow("Invalid feedback response");
    expect(() => parseFeedbackPage(pagePayload([{ feedback: feedbackRow("ent", "store"), metadata: { customerAlias: null, providerNote: null, version: 1.5, updatedAt: "2026-08-13T02:00:00.000Z" } }]))).toThrow("Invalid feedback response");
    expect(() => parseFeedbackPage(pagePayload([{ feedback: feedbackRow("ent", "store"), metadata: { customerAlias: null, providerNote: null, version: 1, updatedAt: "2026-08-13" } }]))).toThrow("Invalid feedback response");
  });

  it("writes only allowlisted metadata fields to the exact encoded customer route", async () => {
    const api = apiWithResponses(jsonResponse({ metadata: {
      customerAlias: "Pilot", providerNote: null, version: 3, updatedAt: "2026-08-13T02:00:00.000Z", accountId: "sentinel-account"
    } }));

    await expect(replaceProviderCustomerMetadata(api, { enterpriseId: "ent_alpha", storeId: "store.one" }, {
      customerAlias: "Pilot", providerNote: null, expectedVersion: 2
    })).resolves.toEqual({
      customerAlias: "Pilot", providerNote: null, version: 3, updatedAt: "2026-08-13T02:00:00.000Z"
    });

    expect(api.fetch).toHaveBeenCalledWith("/v1/provider-customers/ent_alpha/store.one/metadata", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerAlias: "Pilot", providerNote: null, expectedVersion: 2 })
    });
  });
});

describe("read-only feedback workbench", () => {
  it("uses the customer alias as the primary label while retaining both identifiers", async () => {
    const api = apiWithResponses(jsonResponse(pagePayload([feedbackRow("ent-alpha", "store-1")], null)));

    render(<FeedbackWorkbench api={api} />);

    const row = await screen.findByRole("row", { name: /pilot ent-alpha store-1/i });
    expect(row.querySelector("strong")).toHaveTextContent("Pilot");
    expect(row).toHaveTextContent("ent-alpha");
    expect(row).toHaveTextContent("store-1");
  });

  it("searches the loaded page by alias or identifiers without searching notes or fetching", async () => {
    const user = userEvent.setup();
    const api = apiWithResponses(jsonResponse(pagePayload([{ feedback: feedbackRow("ent-alpha", "store-1"), metadata: {
      customerAlias: "Client North", providerNote: "needle only in a private note", version: 2, updatedAt: "2026-08-13T02:00:00.000Z"
    } }], null)));
    render(<FeedbackWorkbench api={api} />);
    await screen.findByText("Client North");

    await user.type(screen.getByLabelText("Current page search"), "client north");
    expect(screen.getByText("Client North")).toBeVisible();
    await user.clear(screen.getByLabelText("Current page search"));
    await user.type(screen.getByLabelText("Current page search"), "needle only in a private note");
    expect(screen.getByText("No identifiers on this loaded page match your search.")).toBeVisible();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it("renders metadata as text with no edit command for a viewer-only account", async () => {
    const api = apiWithResponses(jsonResponse(pagePayload([{ feedback: feedbackRow("ent-alpha", "store-1"), metadata: {
      customerAlias: "<img src=x onerror=sentinel>", providerNote: "<img src=x onerror=sentinel>", version: 2, updatedAt: "2026-08-13T02:00:00.000Z"
    } }], null)));
    render(<FeedbackWorkbench api={api} />);

    expect((await screen.findAllByText("<img src=x onerror=sentinel>")).length).toBe(2);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit customer details" })).not.toBeInTheDocument();
  });

  it("renders an icon-plus-text edit command only when metadata editing is allowed", async () => {
    const api = apiWithResponses(jsonResponse(pagePayload([feedbackRow("ent-alpha", "store-1")], null)));
    render(<FeedbackWorkbench api={api} canEditMetadata />);

    expect(await screen.findByRole("button", { name: "Edit customer details" })).toBeVisible();
  });

  it("replaces the displayed metadata with the normalized save result", async () => {
    const user = userEvent.setup();
    const api = apiWithResponses(
      jsonResponse(pagePayload([feedbackRow("ent-alpha", "store-1")], null)),
      jsonResponse({ metadata: { customerAlias: "Normalized", providerNote: null, version: 3, updatedAt: "2026-08-13T03:00:00.000Z" } })
    );
    render(<FeedbackWorkbench api={api} canEditMetadata />);
    await user.click(await screen.findByRole("button", { name: "Edit customer details" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Normalized")).toBeVisible();
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
  });
  it("loads the default page and renders aggregate identifiers, times, states, and count maps", async () => {
    const api = apiWithResponses(jsonResponse(pagePayload([feedbackRow("ent-alpha", "store-1")])));

    render(<FeedbackWorkbench api={api} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading customer feedback");
    const row = await screen.findByRole("row", { name: /ent-alpha store-1/i });
    expect(row).toHaveTextContent("Aug 12, 2026");
    expect(row).toHaveTextContent("8:00 AM");
    expect(row).toHaveTextContent("9:00 AM");
    expect(row).toHaveTextContent("Active");
    expect(row).toHaveTextContent("Ready");
    expect(row).toHaveTextContent("Missing 0");
    expect(row).toHaveTextContent("Revenue decline 2");
    expect(row).toHaveTextContent("Proposed 1");
    expect(row).toHaveTextContent("Verified 3");
    expect(row).toHaveTextContent("Effective 2");
    expect(row).toHaveTextContent("Data insufficient 1");
    expect(api.fetch).toHaveBeenCalledWith("/v1/provider-customers?limit=50");
    for (const sentinel of sensitiveSentinels) expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
  });

  it("sends exact server filters and resets the prior cursor/page", async () => {
    const user = userEvent.setup();
    const api = apiWithResponses(
      jsonResponse(pagePayload([feedbackRow("ent-first", "store-first")])),
      jsonResponse(pagePayload([feedbackRow("ent-stale", "store-stale")], null)),
      jsonResponse(pagePayload([feedbackRow("ent-filtered", "store-filtered")], null))
    );

    render(<FeedbackWorkbench api={api} />);
    await screen.findByText("ent-first");
    await user.selectOptions(screen.getByLabelText("Activity"), "stale");
    await screen.findByText("ent-stale");
    expect(api.fetch).toHaveBeenLastCalledWith("/v1/provider-customers?limit=50&activityState=stale");
    expect(screen.queryByText("ent-first")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Readiness"), "incomplete");
    await screen.findByText("ent-filtered");
    expect(api.fetch).toHaveBeenLastCalledWith("/v1/provider-customers?limit=50&activityState=stale&readinessState=incomplete");
    expect(api.fetch.mock.calls.at(-1)?.[0]).not.toContain("cursor=");
  });

  it("forwards the opaque cursor unchanged only when loading more", async () => {
    const user = userEvent.setup();
    let resolveNext!: (response: Response) => void;
    const api = apiWithResponses(
      jsonResponse(pagePayload([feedbackRow("ent-first", "store-first")], "opaque+/=cursor")),
      new Promise<Response>((resolve) => { resolveNext = resolve; })
    );

    render(<FeedbackWorkbench api={api} />);
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(api.fetch).toHaveBeenLastCalledWith("/v1/provider-customers?limit=50&cursor=opaque%2B%2F%3Dcursor");
    expect(screen.getByRole("button", { name: "Loading more" })).toBeDisabled();
    expect(screen.getByText("ent-first")).toBeVisible();

    resolveNext(jsonResponse(pagePayload([feedbackRow("ent-second", "store-second")], null)));
    expect(await screen.findByText("ent-second")).toBeVisible();
    expect(screen.getByText("ent-first")).toBeVisible();
  });

  it("discards a pending pagination response after server filters reset the page", async () => {
    const user = userEvent.setup();
    let resolveOldPage!: (response: Response) => void;
    const api = apiWithResponses(
      jsonResponse(pagePayload([feedbackRow("ent-first", "store-first")], "old-cursor")),
      new Promise<Response>((resolve) => { resolveOldPage = resolve; }),
      jsonResponse(pagePayload([feedbackRow("ent-stale", "store-stale")], null))
    );

    render(<FeedbackWorkbench api={api} />);
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    await user.selectOptions(screen.getByLabelText("Activity"), "stale");
    expect(await screen.findByText("ent-stale")).toBeVisible();

    await act(async () => {
      resolveOldPage(jsonResponse(pagePayload([feedbackRow("ent-old-page", "store-old")], null)));
    });
    expect(screen.queryByText("ent-old-page")).not.toBeInTheDocument();
    expect(screen.getByText("ent-stale")).toBeVisible();
  });

  it("filters only the loaded page by enterprise or store without fetching", async () => {
    const user = userEvent.setup();
    const api = apiWithResponses(jsonResponse(pagePayload([
      feedbackRow("IDENTIFIER-Alpha", "store-1"),
      feedbackRow("ent-beta", "Store-North")
    ], null)));

    render(<FeedbackWorkbench api={api} />);
    await screen.findByText("IDENTIFIER-Alpha");
    await user.type(screen.getByLabelText("Current page search"), "identifier");
    expect(screen.getByText("IDENTIFIER-Alpha")).toBeVisible();
    await user.clear(screen.getByLabelText("Current page search"));
    await user.type(screen.getByLabelText("Current page search"), "STORE-north");

    expect(screen.queryByText("IDENTIFIER-Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("ent-beta")).toBeVisible();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unfiltered empty page from a local-filter empty page", async () => {
    const emptyApi = apiWithResponses(jsonResponse(pagePayload([], null)));
    const { unmount } = render(<FeedbackWorkbench api={emptyApi} />);
    expect(await screen.findByText("No customer feedback is available.")).toBeVisible();
    unmount();

    const user = userEvent.setup();
    const populatedApi = apiWithResponses(jsonResponse(pagePayload([feedbackRow("ent-alpha", "store-1")], null)));
    render(<FeedbackWorkbench api={populatedApi} />);
    await screen.findByText("ent-alpha");
    await user.type(screen.getByLabelText("Current page search"), "does-not-match");
    expect(screen.getByText("No identifiers on this loaded page match your search.")).toBeVisible();
  });

  it("offers a neutral retry after network or server failure", async () => {
    const user = userEvent.setup();
    const api = apiWithResponses(
      Promise.reject(new Error("private upstream exception")),
      new Response(JSON.stringify({ secret: "private server body" }), { status: 500 }),
      jsonResponse(pagePayload([feedbackRow("ent-recovered", "store-recovered")], null))
    );

    render(<FeedbackWorkbench api={api} />);
    expect(await screen.findByText("Customer feedback could not be loaded.")).toBeVisible();
    expect(screen.queryByText(/private upstream exception|private server body/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Customer feedback could not be loaded.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("ent-recovered")).toBeVisible();
  });

  it("shows feedback denied on 403 without requesting logout", async () => {
    const onAuthenticationRequired = vi.fn();
    const api = apiWithResponses(new Response(null, { status: 403 }));

    render(<FeedbackWorkbench api={api} onAuthenticationRequired={onAuthenticationRequired} />);

    expect(await screen.findByText("Feedback access is not available for this account.")).toBeVisible();
    expect(onAuthenticationRequired).not.toHaveBeenCalled();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns authentication control to the App on a terminal 401", async () => {
    const onAuthenticationRequired = vi.fn();
    const api = apiWithResponses(new Response(null, { status: 401 }));

    render(<FeedbackWorkbench api={api} onAuthenticationRequired={onAuthenticationRequired} />);

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledTimes(1));
  });
});

function feedbackRow(enterpriseId: string, storeId: string): Record<string, unknown> {
  return {
    enterpriseId,
    storeId,
    lastSuccessfulImportAt: "2026-08-12T08:00:00.000Z",
    lastConfirmedAt: "2026-08-12T09:00:00.000Z",
    lastCoverageAt: "2026-08-12T09:00:00.000Z",
    activityState: "active",
    readinessState: "ready",
    missingMetricCount: 0,
    diagnosticCounts: { revenue_decline: 2 },
    actionCardStatusCounts: { proposed: 1, verified: 3 },
    verificationOutcomeCounts: { effective: 2, data_insufficient: 1 },
    rawImport: "sentinel-raw-import",
    factValue: "sentinel-fact-value",
    metricValue: "sentinel-metric-value",
    fileName: "sentinel-file.csv",
    checksum: "sentinel-checksum",
    objectKey: "sentinel-object-key",
    evidence: "sentinel-evidence",
    actionTitle: "sentinel-action-title",
    actionContent: "sentinel-action-content",
    executionNote: "sentinel-execution-note",
    customerContact: "sentinel-contact"
  };
}

function pagePayload(items: Record<string, unknown>[], nextCursor: string | null = "opaque+/=cursor") {
  return {
    items: items.map((item) => "feedback" in item ? item : {
      feedback: item,
      metadata: {
        customerAlias: "Pilot",
        providerNote: "Internal note",
        version: 2,
        updatedAt: "2026-08-13T02:00:00.000Z",
        accountId: "sentinel-account"
      }
    }),
    nextCursor,
    serverSecret: "sentinel-page-secret"
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function apiWithResponses(...responses: Array<Response | Promise<Response>>): ProviderApiClient & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn();
  for (const response of responses) {
    if (response instanceof Promise) fetch.mockImplementationOnce(() => response);
    else fetch.mockResolvedValueOnce(response);
  }
  return { fetch };
}
