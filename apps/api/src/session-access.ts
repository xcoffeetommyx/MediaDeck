import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';

export const sessionAccessHeader = 'x-mediadeck-session-token';

function cookieName(sessionId: string): string {
  return `mediadeck_stream_${sessionId.replaceAll('-', '_')}`;
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function sessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const value = request.headers[sessionAccessHeader];
  return Array.isArray(value) ? value[0] : value;
}

export function streamTokenFromRequest(
  request: IncomingMessage,
  sessionId: string,
): string | undefined {
  return readCookie(request, cookieName(sessionId));
}

export function setStreamAccessCookie(
  reply: FastifyReply,
  sessionId: string,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): void {
  reply.header(
    'Set-Cookie',
    `${cookieName(sessionId)}=${encodeURIComponent(token)}; HttpOnly; Max-Age=${maxAgeSeconds}; Path=/stream/${sessionId}/; SameSite=Strict${secure ? '; Secure' : ''}`,
  );
}

export function clearStreamAccessCookie(
  reply: FastifyReply,
  sessionId: string,
  secure: boolean,
): void {
  reply.header(
    'Set-Cookie',
    `${cookieName(sessionId)}=; HttpOnly; Max-Age=0; Path=/stream/${sessionId}/; SameSite=Strict${secure ? '; Secure' : ''}`,
  );
}

export function stripStreamAccessCookies(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  const retained = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => !entry.startsWith('mediadeck_stream_'));
  return retained.length > 0 ? retained.join('; ') : undefined;
}
