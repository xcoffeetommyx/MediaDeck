type ApiErrorResponse = {
  message?: string;
  statusCode?: number;
};

const administratorTokenKey = 'mediadeck.administrator-token';

export function clearAdministratorToken(): void {
  sessionStorage.removeItem(administratorTokenKey);
}

export function setAdministratorToken(token: string): void {
  sessionStorage.setItem(administratorTokenKey, token);
}

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = sessionStorage.getItem(administratorTokenKey);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let body: ApiErrorResponse | undefined;
    try {
      body = (await response.json()) as ApiErrorResponse;
    } catch {
      body = undefined;
    }

    throw new ApiError(
      body?.message ?? `MediaDeck request failed with ${response.status}`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
