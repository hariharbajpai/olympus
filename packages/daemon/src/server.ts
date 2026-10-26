import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HealthResponse, ServerFrame } from '@olympus/shared';
import { type Company, CompanyError } from './company.js';
import type { EventBus } from './events.js';

export const DAEMON_VERSION = '0.0.1';

const StartBody = z.object({
  brief: z.string().trim().min(5, 'Write a brief of at least 5 characters.').max(2000),
  mode: z.enum(['claude-code', 'simulated']),
});

const FireBody = z.object({
  reason: z.string().trim().min(1).max(300).default('Fired by the Owner'),
});

const DoneBody = z.object({
  activation_id: z.string().min(1).max(64),
  report: z.string().max(20000).default(''),
});

const AgentToolBody = z.object({
  activation: z.string().min(1).max(64),
  tool: z.enum(['post_message', 'report_status', 'list_team', 'propose_team']),
  input: z.record(z.string(), z.unknown()).default({}),
});

export interface ServerOptions {
  company: Company;
  bus: EventBus;
  token: string;
  port: number;
  allowedOrigins: string[];
  dashboardDir: string;
  onShutdownRequest: () => void;
}

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const startedAt = new Date().toISOString();

  await app.register(fastifyWebsocket);

  // Every API call except the health check needs the owner token. The token is never in a
  // cookie, so other web pages open in the browser can't make requests on the Owner's behalf.
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    if (url === '/api/health') return;
    if (url.startsWith('/api/')) {
      if (!tokenMatches(opts.token, request.headers['x-olympus-token'])) {
        return reply.code(401).send({ error: 'Missing or wrong owner token.' });
      }
    } else if (url === '/ws') {
      const origin = request.headers.origin;
      if (origin && !opts.allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: 'Origin not allowed.' });
      }
      const token = (request.query as Record<string, unknown>).token;
      if (!tokenMatches(opts.token, token)) {
        return reply.code(401).send({ error: 'Missing or wrong owner token.' });
      }
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CompanyError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: error.issues.map((i) => i.message).join('; ') });
    }
    console.error('[api] unexpected error:', error);
    return reply.code(500).send({ error: 'Internal error. See daemon.log.' });
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    ok: true,
    name: 'olympus-daemon',
    version: DAEMON_VERSION,
    pid: process.pid,
    port: opts.port,
    startedAt,
  }));

  app.get('/api/state', async () => opts.company.snapshot());

  app.post('/api/demo/start', async (request, reply) => {
    const body = StartBody.parse(request.body ?? {});
    opts.company.startDemo(body.brief, body.mode);
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/demo/reset', async () => {
    opts.company.reset();
    return { ok: true };
  });

  app.post('/api/employees/:id/fire', async (request) => {
    const { id } = request.params as { id: string };
    const body = FireBody.parse(request.body ?? {});
    opts.company.fire(id, body.reason);
    return { ok: true };
  });

  // The Owner's Claude Code session (through the plugin MCP server) runs the company's work.
  app.post('/api/host/claim', async () => opts.company.hostClaim());

  app.post('/api/host/done', async (request) => {
    const body = DoneBody.parse(request.body ?? {});
    const known = opts.company.hostDone(body.activation_id, body.report);
    return known
      ? { ok: true, text: 'Recorded. Call next_work again.' }
      : { ok: false, text: 'Unknown or already finished activation (it may have been stopped). Call next_work again.' };
  });

  app.post('/api/agent/tool', async (request) => {
    const body = AgentToolBody.parse(request.body ?? {});
    return opts.company.hostTool(body.activation, body.tool, body.input);
  });

  app.post('/api/shutdown', async () => {
    setTimeout(opts.onShutdownRequest, 50);
    return { ok: true };
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const send = (frame: ServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };
    send({ kind: 'hello', state: opts.company.snapshot(), recentEvents: opts.bus.recent(300) });
    const unsubscribe = opts.bus.subscribe((event) => {
      send({ kind: 'event', event, state: opts.company.snapshot() });
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  const indexFile = path.join(opts.dashboardDir, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, { root: opts.dashboardDir, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not found.' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply
        .type('text/plain')
        .send(`Olympus daemon is running, but the dashboard isn't built.\nRun: npm run build\n(looked in ${opts.dashboardDir})`),
    );
  }

  return app;
}
