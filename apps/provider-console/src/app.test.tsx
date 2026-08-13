import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { createSessionClient, type ProviderSession } from "./session";

const viewerSession: ProviderSession = {
  accessToken: "viewer-token",
  expiresAt: "2026-08-13T12:00:00.000Z",
  account: { id: "viewer", displayName: "Service Viewer" },
  capabilities: {
    providerFeedbackViewer: true,
    metricCatalogOperator: false
  }
};

describe("provider console application shell", () => {
  it("shows a stable restoring view while silent restoration is pending", () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));

    render(<App session={createSessionClient(fetcher)} />);

    expect(screen.getByRole("status")).toHaveTextContent("Restoring secure session");
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows the login view after silent restoration fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));

    render(<App session={createSessionClient(fetcher)} />);

    expect(await screen.findByRole("heading", { name: "Provider Feedback Console" })).toBeVisible();
    expect(screen.getByLabelText("Login name")).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("uses a neutral login error and clears the password after submission", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    render(<App session={createSessionClient(fetcher)} />);
    await screen.findByLabelText("Login name");
    await user.type(screen.getByLabelText("Login name"), "unknown-user");
    await user.type(screen.getByLabelText("Password"), "not-the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to sign in with those credentials.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps an authenticated account without provider roles on a no-access page", async () => {
    const noRoleSession = sessionWithCapabilities(false, false);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(noRoleSession));

    render(<App session={createSessionClient(fetcher)} />);

    expect(await screen.findByRole("heading", { name: "No provider access" })).toBeVisible();
    expect(screen.queryByText("Feedback workbench ready")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  it("clears memory and returns to login after logout", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(sessionWithCapabilities(false, false)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = createSessionClient(fetcher);

    render(<App session={session} />);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
    expect(session.snapshot()).toBeNull();
  });

  it("returns to login when logout interrupts a stalled refresh", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      if (String(input) === "/v1/provider-auth/refresh" && fetcher.mock.calls.length === 1) {
        return Promise.resolve(jsonResponse(viewerSession));
      }
      if (String(input) === "/v1/provider-auth/refresh") return new Promise<Response>(() => {});
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const session = createSessionClient(fetcher);

    render(<App session={session} />);
    const signOut = await screen.findByRole("button", { name: "Sign out" });
    const stalledRestore = session.restore();
    fireEvent.click(signOut);

    expect(await screen.findByRole("button", { name: "Sign in" }, { timeout: 250 })).toBeVisible();
    await expect(stalledRestore).rejects.toThrow("Session operation was superseded");
    expect(fetcher.mock.calls.some(([input]) => String(input) === "/v1/provider-auth/logout")).toBe(true);
    expect(session.snapshot()).toBeNull();
  });

  it("shows only a stub workbench for a feedback viewer", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(viewerSession));

    render(<App session={createSessionClient(fetcher)} />);

    expect(await screen.findByRole("heading", { name: "Customer Feedback" })).toBeVisible();
    expect(screen.getByText("Feedback workbench ready")).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows catalog guidance without pretending it is an editor", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(sessionWithCapabilities(false, true)));

    render(<App session={createSessionClient(fetcher)} />);

    expect(await screen.findByRole("heading", { name: "Metric catalog" })).toBeVisible();
    expect(screen.getByText(/controlled CLI/i)).toBeVisible();
    expect(screen.queryByText("Feedback workbench ready")).not.toBeInTheDocument();
  });
});

function sessionWithCapabilities(
  providerFeedbackViewer: boolean,
  metricCatalogOperator: boolean
): ProviderSession {
  return {
    ...viewerSession,
    capabilities: { providerFeedbackViewer, metricCatalogOperator }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
