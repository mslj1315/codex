import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProviderApiClient } from "./api";
import { ProviderCustomerEditor } from "./provider-customer-editor";
import type { ProviderCustomerItem } from "./feedback";

const item: ProviderCustomerItem = {
  feedback: {
    enterpriseId: "ent-alpha", storeId: "store-1", lastSuccessfulImportAt: null,
    lastConfirmedAt: null, lastCoverageAt: null, activityState: "active",
    readinessState: "ready", missingMetricCount: 0, diagnosticCounts: {},
    actionCardStatusCounts: {}, verificationOutcomeCounts: {}
  },
  metadata: { customerAlias: "Pilot", providerNote: "Initial note", version: 2, updatedAt: "2026-08-13T02:00:00.000Z" }
};

describe("ProviderCustomerEditor", () => {
  it("initializes plain fields from current metadata and exposes the defined limits", () => {
    renderEditor();

    expect(screen.getByLabelText("Customer alias")).toHaveValue("Pilot");
    expect(screen.getByLabelText("Provider note")).toHaveValue("Initial note");
    expect(screen.getByLabelText("Customer alias")).toHaveAttribute("maxLength", "120");
    expect(screen.getByLabelText("Provider note")).toHaveAttribute("maxLength", "2000");
  });

  it("submits one pending save with both fields and the current version", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    const api = apiWith(new Promise<Response>((done) => { resolve = done; }));
    renderEditor({ api });
    await user.clear(screen.getByLabelText("Customer alias"));
    await user.type(screen.getByLabelText("Customer alias"), "Pilot North");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Saving" }));

    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(api.fetch).toHaveBeenCalledWith("/v1/provider-customers/ent-alpha/store-1/metadata", expect.objectContaining({
      body: JSON.stringify({ customerAlias: "Pilot North", providerNote: "Initial note", expectedVersion: 2 })
    }));
    resolve(jsonResponse({ metadata: item.metadata }));
  });

  it("uses null expectedVersion when creating metadata", async () => {
    const user = userEvent.setup();
    const api = apiWith(jsonResponse({ metadata: { customerAlias: "New", providerNote: null, version: 1, updatedAt: "2026-08-13T02:00:00.000Z" } }));
    renderEditor({ api, item: { ...item, metadata: null } });
    await user.type(screen.getByLabelText("Customer alias"), "New");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(api.fetch).toHaveBeenCalledWith("/v1/provider-customers/ent-alpha/store-1/metadata", expect.objectContaining({
      body: JSON.stringify({ customerAlias: "New", providerNote: null, expectedVersion: null })
    }));
  });

  it("clears both metadata fields using the current version", async () => {
    const user = userEvent.setup();
    const api = apiWith(jsonResponse({ metadata: null }));
    renderEditor({ api });
    await user.clear(screen.getByLabelText("Customer alias"));
    await user.clear(screen.getByLabelText("Provider note"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(api.fetch).toHaveBeenCalledWith("/v1/provider-customers/ent-alpha/store-1/metadata", expect.objectContaining({
      body: JSON.stringify({ customerAlias: null, providerNote: null, expectedVersion: 2 })
    }));
  });

  it("returns the server-normalized metadata to its owner", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderEditor({ onSaved, api: apiWith(jsonResponse({ metadata: { customerAlias: "Normalized", providerNote: null, version: 3, updatedAt: "2026-08-13T03:00:00.000Z" } })) });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ customerAlias: "Normalized", providerNote: null, version: 3, updatedAt: "2026-08-13T03:00:00.000Z" }));
  });

  it("keeps the draft on conflict and reloads only after explicit activation", async () => {
    const user = userEvent.setup();
    const onReloadRequested = vi.fn();
    renderEditor({ onReloadRequested, api: apiWith(new Response(null, { status: 409 })) });
    await user.clear(screen.getByLabelText("Customer alias"));
    await user.type(screen.getByLabelText("Customer alias"), "Unsaved draft");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This customer changed elsewhere. Review the latest values before saving again.")).toBeVisible();
    expect(screen.getByLabelText("Customer alias")).toHaveValue("Unsaved draft");
    expect(onReloadRequested).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReloadRequested).toHaveBeenCalledTimes(1);
  });

  it("keeps its draft for retry after a server failure without exposing response text", async () => {
    const user = userEvent.setup();
    renderEditor({ api: apiWith(new Response(JSON.stringify({ detail: "private upstream response" }), { status: 500 })) });
    await user.clear(screen.getByLabelText("Customer alias"));
    await user.type(screen.getByLabelText("Customer alias"), "Retry draft");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Customer details could not be saved.")).toBeVisible();
    expect(screen.getByLabelText("Customer alias")).toHaveValue("Retry draft");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByText("private upstream response")).not.toBeInTheDocument();
  });

  it("closes editing on 403 and returns authentication control on 401", async () => {
    const user = userEvent.setup();
    const onAuthenticationRequired = vi.fn();
    const { rerender } = renderEditor({ api: apiWith(new Response(null, { status: 403 })), onAuthenticationRequired });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(onAuthenticationRequired).not.toHaveBeenCalled();

    rerender(<ProviderCustomerEditor key="new-editor" api={apiWith(new Response(null, { status: 401 }))} item={item} onAuthenticationRequired={onAuthenticationRequired} onReloadRequested={vi.fn()} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledTimes(1));
  });
});

function renderEditor(overrides: Partial<React.ComponentProps<typeof ProviderCustomerEditor>> = {}) {
  const props = {
    item,
    api: apiWith(jsonResponse({ metadata: item.metadata })),
    onSaved: vi.fn(),
    onAuthenticationRequired: vi.fn(),
    onReloadRequested: vi.fn(),
    ...overrides
  };
  return render(<ProviderCustomerEditor {...props} />);
}

function apiWith(...responses: Array<Response | Promise<Response>>): ProviderApiClient & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn();
  for (const response of responses) {
    if (response instanceof Promise) fetch.mockImplementationOnce(() => response);
    else fetch.mockResolvedValueOnce(response);
  }
  return { fetch };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
