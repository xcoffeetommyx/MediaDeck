type ApiErrorResponse = {
  message?: string;
  statusCode?: number;
};

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
  const response = await fetch(input, init);
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

  return (await response.json()) as T;
}
