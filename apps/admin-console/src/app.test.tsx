import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./app";

describe("unified admin navigation", () => {
  it("renders only the Chinese sections allowed by the server permission summary", () => {
    render(<App session={{ account: { id: "admin-1", displayName: "管理员" }, permissions: ["customer_accounts.create"] }} />);

    expect(screen.getByRole("navigation")).toHaveTextContent("客户管理");
    expect(screen.queryByText("模型运营")).not.toBeInTheDocument();
    expect(screen.queryByText("内容运营")).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-[A-Za-z0-9]|ciphertext/i)).not.toBeInTheDocument();
  });
});
