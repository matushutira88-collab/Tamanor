/**
 * Auth calls against the Tamanor mobile API.
 *
 * Thin wrappers over {@link apiRequest}. The password appears only as a field of
 * the login request body and is never stored, retained or logged by this module.
 */

import { apiRequest, type ClientConfig } from "./client";
import type { ApiResult, LoginResponse, SessionResponse } from "./types";

export const AUTH_ROUTES = {
  login: "/api/mobile/auth/login",
  session: "/api/mobile/auth/session",
  logout: "/api/mobile/auth/logout",
} as const;

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
  /** Reserved for a native challenge flow; unused until that ships (see README). */
  challengeToken?: string;
}

/** Exchange credentials for a fresh server-issued opaque session token. */
export function login(credentials: LoginCredentials, config?: ClientConfig): Promise<ApiResult<LoginResponse>> {
  return apiRequest<LoginResponse>(
    AUTH_ROUTES.login,
    {
      method: "POST",
      body: {
        email: credentials.email,
        password: credentials.password,
        rememberMe: credentials.rememberMe,
        ...(credentials.challengeToken ? { challengeToken: credentials.challengeToken } : null),
      },
    },
    config,
  );
}

/**
 * Ask the server whether this token is still valid, and for the current account
 * context. This is the ONLY authority on whether the app is signed in.
 */
export function fetchSession(token: string, config?: ClientConfig): Promise<ApiResult<SessionResponse>> {
  return apiRequest<SessionResponse>(AUTH_ROUTES.session, { method: "GET", token }, config);
}

/** Revoke the session server-side. */
export function logout(token: string, config?: ClientConfig): Promise<ApiResult<{ ok: boolean }>> {
  return apiRequest<{ ok: boolean }>(AUTH_ROUTES.logout, { method: "POST", token }, config);
}
