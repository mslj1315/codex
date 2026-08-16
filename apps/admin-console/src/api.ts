export type AdminSession = { account: { id: string; displayName: string }; permissions: string[] };
export type AdminApi = {
  request(path: string, init?: RequestInit): Promise<Response>;
  login(loginName: string, password: string): Promise<AdminSession>;
  changePassword(currentPassword: string, newPassword: string): Promise<Response>;
};

export function browserApi(): AdminApi {
  let token = "";
  const request = (path: string, init: RequestInit = {}) => fetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` }
  });
  return {
    request,
    async login(loginName, password) {
      const login = await fetch("/v1/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginName, password })
      });
      if (!login.ok) throw new Error("login failed");
      const body = await login.json() as { accessToken?: unknown };
      if (typeof body.accessToken !== "string") throw new Error("login failed");
      token = body.accessToken;
      const permissions = await request("/v1/auth/me/internal-permissions");
      if (!permissions.ok) throw new Error("internal permissions unavailable");
      return permissions.json() as Promise<AdminSession>;
    },
    async changePassword(currentPassword, newPassword) {
      const response = await request("/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (response.status === 204) token = "";
      return response;
    }
  };
}
