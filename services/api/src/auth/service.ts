import { randomUUID } from "node:crypto";
import type { TrustedContext } from "../imports/service.js";
import { hashNewPassword, hashPassword, isBcryptPasswordLength, isLegacyScryptPasswordHash, isNewPassword, verifyPassword } from "./credentials.js";
import { AuthRepository, type ServiceOperatorRole, type StoreMembership } from "./repository.js";
import { InternalAuthorizationError, InternalPermissionRepository, requireInternalPermission, type InternalPermission } from "../admin/rbac.js";
import { AuthenticationError, createRefreshToken, hashRefreshToken, issueAccessToken, parseAccessToken } from "./tokens.js";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  account: { id: string; displayName: string };
  passwordChangeRequired: boolean;
}

export interface ProviderCapabilities {
  providerFeedbackViewer: boolean;
  metricCatalogOperator: boolean;
  providerCustomerMetadataEditor: boolean;
  modelPricingOperator: boolean;
}

export class AuthorizationError extends Error {}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly secret: string,
    private readonly now: () => Date
  ) {}

  async login(input: { loginName: string; password: string }): Promise<AuthTokens> {
    const account = await this.repository.findAccountByLoginName(normalizeLoginName(input.loginName));
    if (!account?.enabled || !await verifyPassword(input.password, account.passwordHash)) throw new AuthenticationError("Authentication required");
    if (isLegacyScryptPasswordHash(account.passwordHash) && isBcryptPasswordLength(input.password)) {
      await this.repository.upgradeLegacyPasswordHash(account.id, account.passwordHash, await hashPassword(input.password));
    }
    return this.createTokens(account);
  }

  async refresh(input: { refreshToken: string }): Promise<AuthTokens> {
    const refreshToken = requireRefreshToken(input.refreshToken);
    const now = this.now();
    const nextRefreshToken = createRefreshToken();
    const nextSessionId = randomUUID();
    const account = await this.repository.rotateSession({
      refreshTokenHash: hashRefreshToken(refreshToken), nextSessionId,
      nextRefreshTokenHash: hashRefreshToken(nextRefreshToken), nextExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS), now
    });
    if (!account) throw new AuthenticationError("Authentication required");
    return this.tokensFor(account, nextRefreshToken, now, nextSessionId);
  }

  async logout(accessToken: string): Promise<void> {
    const identity = parseAccessToken(accessToken, this.secret, this.now());
    if (!await this.repository.revokeSession(identity.accountId, identity.sessionId, this.now())) throw new AuthenticationError("Authentication required");
  }

  async changePassword(accessToken: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
    if (!isNewPassword(input.newPassword)) throw new AuthenticationError("Authentication required");
    const identity = parseAccessToken(accessToken, this.secret, this.now());
    const account = await this.repository.findActiveSession(identity.accountId, identity.sessionId, this.now());
    if (!account || !await verifyPassword(input.currentPassword, account.passwordHash)) throw new AuthenticationError("Authentication required");
    if (!await this.repository.changePassword({ accountId: account.id, currentPasswordHash: account.passwordHash, nextPasswordHash: await hashNewPassword(input.newPassword) })) throw new AuthenticationError("Authentication required");
  }

  async authenticateAccessToken(accessToken: string): Promise<{ id: string; displayName: string }> {
    const account = await this.authenticatedAccount(accessToken);
    return { id: account.id, displayName: account.displayName };
  }

  private async authenticatedAccount(accessToken: string): Promise<{ id: string; displayName: string; passwordChangeRequired: boolean }> {
    const identity = parseAccessToken(accessToken, this.secret, this.now());
    const account = await this.repository.findActiveSession(identity.accountId, identity.sessionId, this.now());
    if (!account) throw new AuthenticationError("Authentication required");
    return { id: account.id, displayName: account.displayName, passwordChangeRequired: account.passwordChangeRequired };
  }

  async providerSession(accessToken: string): Promise<{
    account: { id: string; displayName: string };
    capabilities: ProviderCapabilities;
  }> {
    const account = await this.authenticateAccessToken(accessToken);
    const roles = new Set(await this.repository.listEnabledServiceOperatorRoles(account.id));
    return {
      account: { id: account.id, displayName: account.displayName },
      capabilities: {
        providerFeedbackViewer: roles.has("provider_feedback_viewer"),
        metricCatalogOperator: roles.has("metric_catalog_operator"),
        providerCustomerMetadataEditor: roles.has("provider_customer_metadata_editor")
        ,modelPricingOperator: roles.has("model_pricing_operator")
      }
    };
  }

  async resolveStoreContext(accessToken: string, storeId: string): Promise<TrustedContext> {
    const account = await this.authenticatedAccount(accessToken);
    await this.requireCustomerResourcePrincipal(account);
    const membership = await this.repository.findEnabledMembership(account.id, storeId);
    if (!membership) throw new AuthorizationError("Store is not authorized");
    return { enterpriseId: membership.enterpriseId, storeId: membership.storeId, actorId: account.id };
  }

  async listStores(accessToken: string): Promise<StoreMembership[]> {
    const account = await this.authenticatedAccount(accessToken);
    await this.requireCustomerResourcePrincipal(account);
    return this.repository.listEnabledMemberships(account.id);
  }

  async requireServiceOperatorRole(accessToken: string, role: ServiceOperatorRole): Promise<{ id: string; displayName: string }> {
    return this.requireServiceOperatorRoles(accessToken, [role]);
  }

  async requireServiceOperatorRoles(accessToken: string, requiredRoles: readonly ServiceOperatorRole[]): Promise<{ id: string; displayName: string }> {
    const account = await this.authenticateAccessToken(accessToken);
    const enabledRoles = new Set(await this.repository.listEnabledServiceOperatorRoles(account.id));
    if (requiredRoles.some((role) => !enabledRoles.has(role))) {
      throw new AuthorizationError("Service role is not authorized");
    }
    return account;
  }

  async internalPermissions(accessToken: string): Promise<{ account: { id: string; displayName: string }; permissions: string[] }> {
    const account = await this.authenticateAccessToken(accessToken);
    const permissions = await new InternalPermissionRepository(this.repository.databaseConnection()).permissionsFor(account.id);
    if (permissions.size === 0) throw new AuthorizationError("Internal account is not authorized");
    return { account, permissions: [...permissions].sort() };
  }

  async requireInternalPermission<T>(
    accessToken: string,
    permission: InternalPermission,
    protectedWork: (account: { id: string; displayName: string }) => Promise<T> | T
  ): Promise<T> {
    const account = await this.authenticateAccessToken(accessToken);
    const permissions = await new InternalPermissionRepository(this.repository.databaseConnection()).permissionsFor(account.id);
    try {
      return await requireInternalPermission(permissions, permission, () => protectedWork(account));
    } catch (error) {
      if (error instanceof InternalAuthorizationError) {
        throw new AuthorizationError("Internal account is not authorized");
      }
      throw error;
    }
  }

  private async createTokens(account: { id: string; displayName: string; passwordChangeRequired: boolean; credentialVersion: number }): Promise<AuthTokens> {
    const now = this.now();
    const refreshToken = createRefreshToken();
    const sessionId = randomUUID();
    await this.repository.createSession({
      id: sessionId, accountId: account.id, credentialVersion: account.credentialVersion, refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS)
    });
    return this.tokensFor(account, refreshToken, now, sessionId);
  }

  private async requireCustomerResourcePrincipal(account: { id: string; passwordChangeRequired: boolean }): Promise<void> {
    const internalPermissions = new InternalPermissionRepository(this.repository.databaseConnection());
    const [serviceOperatorRoles, isInternalAccount] = await Promise.all([
      this.repository.listEnabledServiceOperatorRoles(account.id),
      internalPermissions.hasEnabledInternalRole(account.id)
    ]);
    // Internal users are authorized only through internal management routes. They must never
    // obtain a customer resource principal merely by also having a store membership.
    if (serviceOperatorRoles.length > 0 || isInternalAccount || account.passwordChangeRequired) {
      throw new AuthorizationError("Service operators cannot access customer resources");
    }
  }

  private tokensFor(account: { id: string; displayName: string; passwordChangeRequired: boolean; credentialVersion: number }, refreshToken: string, now: Date, sessionId = randomUUID()): AuthTokens {
    return {
      accessToken: issueAccessToken({ accountId: account.id, sessionId }, this.secret, now),
      refreshToken,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      account: { id: account.id, displayName: account.displayName }, passwordChangeRequired: account.passwordChangeRequired
    };
  }
}

function normalizeLoginName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new AuthenticationError("Authentication required");
  const compactMobile = normalized.replace(/[\s-]/g, "").replace(/^\+?86/, "");
  if (/^1[3-9]\d{9}$/.test(compactMobile)) return compactMobile;
  return normalized;
}

function requireRefreshToken(value: string): string {
  if (!value || typeof value !== "string") throw new AuthenticationError("Authentication required");
  return value;
}
