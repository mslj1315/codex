const PROVIDER_REFRESH_COOKIE = "provider_refresh";
const PROVIDER_COOKIE_PATH = "/v1/provider-auth/";
const PROVIDER_REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function serializeProviderRefreshCookie(value: string, developmentMode: boolean): string {
  return [
    `${PROVIDER_REFRESH_COOKIE}=${encodeURIComponent(value)}`,
    "HttpOnly",
    ...(developmentMode ? [] : ["Secure"]),
    "SameSite=Strict",
    `Path=${PROVIDER_COOKIE_PATH}`,
    `Max-Age=${PROVIDER_REFRESH_MAX_AGE_SECONDS}`
  ].join("; ");
}

export function clearProviderRefreshCookie(developmentMode: boolean): string {
  return [
    `${PROVIDER_REFRESH_COOKIE}=`,
    "HttpOnly",
    ...(developmentMode ? [] : ["Secure"]),
    "SameSite=Strict",
    `Path=${PROVIDER_COOKIE_PATH}`,
    "Max-Age=0"
  ].join("; ");
}

export function readProviderRefreshCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${PROVIDER_REFRESH_COOKIE}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(PROVIDER_REFRESH_COOKIE.length + 1);
  if (!value) return undefined;
  try { return decodeURIComponent(value); }
  catch { return undefined; }
}
