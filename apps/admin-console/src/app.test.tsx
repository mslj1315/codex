import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, type AdminApi, type AdminSession } from "./app";

const session: AdminSession = {
  account: { id: "admin-1", displayName: "\u7ba1\u7406\u5458" },
  permissions: ["customer_accounts.read", "model_pricing.read", "model_usage.read"]
};

function api(): AdminApi {
  return { login: vi.fn(), request: vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) };
}

describe("unified admin console", () => {
  afterEach(cleanup);
  it("uses exact permissions rather than permission prefixes for navigation", () => {
    render(<App session={session} api={api()} />);

    expect(screen.getByRole("navigation")).toHaveTextContent("\u5ba2\u6237\u7ba1\u7406");
    expect(screen.getByRole("navigation")).toHaveTextContent("\u6a21\u578b\u8ba1\u8d39");
    expect(screen.queryByText("\u6a21\u578b\u914d\u7f6e")).not.toBeInTheDocument();
    expect(screen.queryByText("\u5185\u5bb9\u8fd0\u8425")).not.toBeInTheDocument();
  });

  it("uses the internal pricing API and presents separate input and output prices", async () => {
    const client = api();
    render(<App session={session} api={client} />);
    await userEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "\u6a21\u578b\u8ba1\u8d39" }));

    expect(client.request).toHaveBeenCalledWith("/v1/admin/model-pricing/versions");
    expect(client.request).toHaveBeenCalledWith("/v1/admin/model-pricing/usage");
    expect(screen.getByText("\u8f93\u5165\u4ef7\u683c")).toBeInTheDocument();
    expect(screen.getByText("\u8f93\u51fa\u4ef7\u683c")).toBeInTheDocument();
  });

  it("shows a neutral failure for an internal login that cannot obtain permissions", async () => {
    const client: AdminApi = { login: vi.fn(async () => { throw new Error("forbidden"); }), request: vi.fn() };
    render(<App api={client} />);
    await userEvent.type(screen.getByLabelText("\u8d26\u53f7"), "admin");
    await userEvent.type(screen.getByLabelText("\u5bc6\u7801"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "\u767b\u5f55" }));

    expect(screen.getByRole("alert")).toHaveTextContent("\u8d26\u53f7\u3001\u5bc6\u7801\u6216\u540e\u53f0\u6743\u9650\u65e0\u6548");
  });

  it("offers direct safe operations without fetching lists for manage-only permissions", async () => {
    const client = api();
    render(<App session={{ account: { id: "admin-2", displayName: "\u7ba1\u7406\u5458" }, permissions: ["model_assignments.manage", "model_configs.manage", "model_pricing.manage"] }} api={client} />);

    await userEvent.click(screen.getByRole("button", { name: "\u5ba2\u6237\u7ba1\u7406" }));
    expect(screen.getByLabelText("\u4f01\u4e1a ID")).toBeInTheDocument();
    expect(screen.getByLabelText(/\u6a21\u578b\u914d\u7f6e ID/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "\u6a21\u578b\u914d\u7f6e" }));
    expect(screen.getByLabelText("\u5df2\u6709\u6a21\u578b\u914d\u7f6e ID")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "\u6a21\u578b\u8ba1\u8d39" }));
    expect(screen.getByLabelText("\u5df2\u6709\u8ba1\u8d39\u7248\u672c ID")).toBeInTheDocument();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("sends a direct assignment only with the assignment permission", async () => {
    const client = api();
    render(<App session={{ account: { id: "admin-3", displayName: "\u7ba1\u7406\u5458" }, permissions: ["model_assignments.manage"] }} api={client} />);
    await userEvent.click(screen.getByRole("button", { name: "\u5ba2\u6237\u7ba1\u7406" }));
    await userEvent.type(screen.getByLabelText("\u4f01\u4e1a ID"), "ent-1");
    await userEvent.type(screen.getByLabelText("\u95e8\u5e97 ID"), "store-1");
    await userEvent.type(screen.getByLabelText(/\u6a21\u578b\u914d\u7f6e ID/), "model-1");
    await userEvent.click(screen.getByRole("button", { name: "\u63d0\u4ea4\u6a21\u578b\u5206\u914d" }));

    expect(client.request).toHaveBeenCalledWith("/v1/admin/customer-model-assignments/ent-1/store-1", expect.objectContaining({ method: "PUT" }));
  });
});
