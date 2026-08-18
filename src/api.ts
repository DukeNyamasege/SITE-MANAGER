export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
