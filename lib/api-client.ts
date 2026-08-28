'use client';

import { signOut } from 'next-auth/react';

/**
 * Client-side fetch wrapper.
 *
 * Two jobs beyond plain fetch:
 *
 * 1. Unwraps the house error shape `{ error: string }` into a thrown Error, so
 *    every caller can just try/catch instead of checking res.ok by hand.
 *
 * 2. Signs the user out when the server reports ACCOUNT_DISABLED. Staff
 *    deactivation is enforced server-side on the next request, which without
 *    this leaves the deactivated user staring at a screen of failed panels
 *    rather than being told what happened.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, string[]>;
  /**
   * The full error body. Some responses carry more than a message — a
   * duplicate-patient 409 returns the candidate records so the form can offer
   * to open one instead of registering a second chart.
   */
  readonly body: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, string[]>,
    body: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = body;
  }
}

let signingOut = false;

async function handleDisabled(): Promise<never> {
  // Guard against a page firing several requests at once and each triggering
  // its own redirect.
  if (!signingOut) {
    signingOut = true;
    await signOut({ callbackUrl: '/login?error=ACCOUNT_DISABLED' });
  }
  throw new ApiError('Your account has been deactivated.', 403, 'ACCOUNT_DISABLED');
}

export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A non-JSON body from a proxy or a crash page.
      if (!res.ok) throw new ApiError(text.slice(0, 200), res.status);
    }
  }

  if (!res.ok) {
    const body = (payload ?? {}) as {
      error?: string;
      code?: string;
      details?: Record<string, string[]>;
    };

    if (body.code === 'ACCOUNT_DISABLED') await handleDisabled();

    throw new ApiError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
      body.code,
      body.details,
      body as Record<string, unknown>
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(url: string) => fetchJson<T>(url),

  post: <T>(url: string, body?: unknown) =>
    fetchJson<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),

  put: <T>(url: string, body?: unknown) =>
    fetchJson<T>(url, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),

  patch: <T>(url: string, body?: unknown) =>
    fetchJson<T>(url, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),

  del: <T>(url: string) => fetchJson<T>(url, { method: 'DELETE' }),
};

/** Build a query string, dropping empty values so URLs stay readable. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
