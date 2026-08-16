import { type FormEvent, useState } from "react";
import type { AdminApi } from "./api";

export function AccountSecurity({ api, onPasswordChanged }: { api: AdminApi; onPasswordChanged: () => void }) {
  const [failure, setFailure] = useState<"format" | "mismatch" | "request" | undefined>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      formElement.reset();
      setFailure("mismatch");
      return;
    }
    if (!isNewPassword(newPassword)) {
      formElement.reset();
      setFailure("format");
      return;
    }

    try {
      setFailure(undefined);
      const response = await api.changePassword(currentPassword, newPassword);
      if (response.status !== 204) throw new Error("password change failed");
      formElement.reset();
      onPasswordChanged();
    } catch {
      formElement.reset();
      setFailure("request");
    }
  }

  return <section><p>新密码至少 8 位，包含大写字母和小写字母。</p><form onSubmit={event => void submit(event)}>
    <label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>新密码<input name="newPassword" type="password" autoComplete="new-password" required /></label>
    <label>确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" required /></label>
    {failure === "mismatch" && <p role="alert">请确认两次输入的新密码一致</p>}
    {failure === "format" && <p role="alert">新密码至少 8 位，且包含大写字母和小写字母</p>}
    {failure === "request" && <p role="alert">密码修改失败，请稍后重试</p>}
    <button>保存新密码</button>
  </form></section>;
}

function isNewPassword(password: string) {
  return Array.from(password).length >= 8 && new TextEncoder().encode(password).length <= 72 && /[A-Z]/.test(password) && /[a-z]/.test(password);
}
