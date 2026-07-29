import { request } from 'node:http';

export class DockerEngineError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DockerEngineError';
  }
}

type DockerEngineRequest = {
  body?: unknown;
  expectedStatuses?: number[];
  method?: string;
  path: string;
  timeoutMilliseconds?: number;
};

export class DockerEngineClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMilliseconds = 30_000,
  ) {}

  async request({
    body,
    expectedStatuses = [200],
    method = 'GET',
    path,
    timeoutMilliseconds = this.timeoutMilliseconds,
  }: DockerEngineRequest): Promise<string> {
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise<string>((resolve, reject) => {
      const dockerRequest = request(
        {
          headers: payload
            ? {
                'Content-Length': Buffer.byteLength(payload),
                'Content-Type': 'application/json',
              }
            : undefined,
          method,
          path,
          socketPath: this.socketPath,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const responseBody = Buffer.concat(chunks).toString('utf8');
            const statusCode = response.statusCode ?? 500;

            if (!expectedStatuses.includes(statusCode)) {
              reject(
                new DockerEngineError(
                  responseBody || `Docker Engine returned HTTP ${statusCode}`,
                  statusCode,
                ),
              );
              return;
            }

            resolve(responseBody);
          });
        },
      );

      dockerRequest.on('error', reject);
      dockerRequest.setTimeout(timeoutMilliseconds, () => {
        dockerRequest.destroy(
          new Error(`Docker Engine did not respond within ${timeoutMilliseconds} ms`),
        );
      });
      if (payload) {
        dockerRequest.write(payload);
      }
      dockerRequest.end();
    });
  }
}
