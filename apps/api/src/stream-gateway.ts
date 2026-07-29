import { request as requestHttp } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DomainError } from './domain-errors.js';
import { streamTokenFromRequest, stripStreamAccessCookies } from './session-access.js';
import type { SessionManager } from './session-manager.js';

const sessionIdSchema = z.uuid();
const streamPathPattern =
  /^\/stream\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i;
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function createUpstreamHeaders(
  request: IncomingMessage,
  target: URL,
): IncomingHttpHeaders {
  const headers = { ...request.headers };
  for (const header of hopByHopHeaders) {
    delete headers[header];
  }

  headers.host = target.host;
  const cookie = stripStreamAccessCookies(request.headers.cookie);
  if (cookie) {
    headers.cookie = cookie;
  } else {
    delete headers.cookie;
  }
  headers['x-forwarded-host'] = request.headers.host;
  headers['x-forwarded-proto'] = request.headers['x-forwarded-proto'] ?? 'http';
  return headers;
}

function proxyHttpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  target: URL,
): void {
  reply.hijack();
  const upstream = requestHttp(
    {
      headers: createUpstreamHeaders(request.raw, target),
      hostname: target.hostname,
      method: request.method,
      path: request.raw.url,
      port: target.port || 80,
    },
    (response) => {
      const headers = { ...response.headers };
      for (const header of hopByHopHeaders) {
        delete headers[header];
      }

      reply.raw.writeHead(response.statusCode ?? 502, headers);
      response.pipe(reply.raw);
    },
  );

  upstream.on('error', () => {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    reply.raw.end('The browser stream is temporarily unavailable.');
  });

  request.raw.on('aborted', () => upstream.destroy());
  request.raw.pipe(upstream);
}

function writeUpgradeResponse(
  socket: Socket,
  statusCode: number,
  statusText: string,
): void {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function proxyWebSocket(
  request: IncomingMessage,
  socket: Socket,
  head: Buffer,
  target: URL,
): void {
  const upstream = requestHttp({
    headers: {
      ...createUpstreamHeaders(request, target),
      connection: 'Upgrade',
      upgrade: request.headers.upgrade ?? 'websocket',
    },
    hostname: target.hostname,
    method: request.method,
    path: request.url,
    port: target.port || 80,
  });

  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    const statusLine = `HTTP/${response.httpVersion} ${response.statusCode ?? 101} ${response.statusMessage ?? 'Switching Protocols'}\r\n`;
    const responseHeaders = Object.entries(response.headers)
      .flatMap(([name, value]) =>
        Array.isArray(value)
          ? value.map((entry) => `${name}: ${entry}\r\n`)
          : value === undefined
            ? []
            : [`${name}: ${value}\r\n`],
      )
      .join('');

    socket.write(`${statusLine}${responseHeaders}\r\n`);
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstream.on('response', (response) => {
    writeUpgradeResponse(
      socket,
      response.statusCode ?? 502,
      response.statusMessage ?? 'Bad Gateway',
    );
    response.resume();
  });
  upstream.on('error', () => writeUpgradeResponse(socket, 502, 'Bad Gateway'));
  socket.on('error', () => upstream.destroy());
  upstream.end();
}

export function registerStreamGateway(
  app: FastifyInstance,
  sessions: SessionManager,
): void {
  app.get('/stream/:sessionId', (request, reply) => {
    const parameters = z.object({ sessionId: z.uuid() }).parse(request.params);
    return reply.redirect(`/stream/${parameters.sessionId}/`, 308);
  });

  app.route({
    handler: (request, reply) => {
      const parameters = z.object({ sessionId: z.uuid() }).parse(request.params);
      proxyHttpRequest(
        request,
        reply,
        sessions.getAuthorizedStreamTarget(
          parameters.sessionId,
          streamTokenFromRequest(request.raw, parameters.sessionId),
        ),
      );
    },
    method: ['GET', 'HEAD'],
    url: '/stream/:sessionId/*',
  });

  const handleUpgrade = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void => {
    const match = streamPathPattern.exec(request.url ?? '');
    if (!match?.[1]) {
      writeUpgradeResponse(socket, 404, 'Not Found');
      return;
    }

    try {
      const sessionId = sessionIdSchema.parse(match[1]);
      proxyWebSocket(
        request,
        socket,
        head,
        sessions.getAuthorizedStreamTarget(
          sessionId,
          streamTokenFromRequest(request, sessionId),
        ),
      );
    } catch (error) {
      const statusCode = error instanceof DomainError ? error.statusCode : 400;
      writeUpgradeResponse(
        socket,
        statusCode,
        statusCode === 404 ? 'Not Found' : 'Stream Unavailable',
      );
    }
  };

  app.server.on('upgrade', handleUpgrade);
  app.addHook('onClose', () => {
    app.server.off('upgrade', handleUpgrade);
  });
}
