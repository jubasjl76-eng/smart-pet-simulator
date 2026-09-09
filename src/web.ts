#!/usr/bin/env node
/**
 * smart-pet-simulator web panel — a visual way to drive the virtual kennel.
 *
 *   npm run web            # then open http://localhost:4100
 *
 * It runs the same SimRunner as the CLI (virtual devices connect to the broker
 * and answer commands), plus:
 *   - a static control page
 *   - POST /publish  {topic, payload}   → publishes to the broker
 *   - POST /fault    {deviceId, fault, on} → injects/clears a device fault
 *   - GET  /events   (SSE)              → every message on kennel/# live
 *
 * Env: MQTT_URL (default mqtt://localhost:1883), WEB_PORT (default 4100),
 *      SIM_KENNEL (override kennelId for the roster).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import mqtt from 'mqtt';
import { SimRunner } from './runner.js';
import { SCENARIOS } from './scenarios.js';
import type { Scenario } from './scenarios.js';

const PORT = Number(process.env.WEB_PORT || 4100);
const BROKER = process.env.MQTT_URL || 'mqtt://localhost:1883';
const KENNEL = process.env.SIM_KENNEL;
const PAGE = new URL('../public/index.html', import.meta.url);

// Reuse the happy-path roster with no scripted timeline; the operator is the timeline.
const roster: Scenario = {
  name: 'manual',
  description: 'web control panel',
  devices: SCENARIOS['happy-path'].devices.map((d) => ({ ...d, kennelId: KENNEL || d.kennelId })),
  timeline: [],
};

const runner = new SimRunner(roster, { brokerUrl: BROKER, onLog: (l) => console.log(l) });

// A second client: publish operator commands + tap kennel/# for the live log.
const bridge = mqtt.connect(BROKER, { clientId: `sim-web-${process.pid}` });
const sseClients = new Set<http.ServerResponse>();
bridge.on('connect', () => bridge.subscribe('kennel/#', { qos: 0 }));
bridge.on('message', (topic, payload) => {
  const line = `data: ${JSON.stringify({ topic, payload: payload.toString(), ts: Date.now() })}\n\n`;
  for (const res of sseClients) res.write(line);
});

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const json = (res: http.ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(PAGE));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/devices') {
    return json(res, 200, { broker: BROKER, devices: runner.deviceSpecs });
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/publish') {
    const { topic, payload } = await readBody(req);
    if (!topic) return json(res, 400, { error: 'topic required' });
    const t = String(topic);
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    bridge.publish(t, body, { qos: t.endsWith('/command') ? 2 : 1, retain: t.endsWith('/status') });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/fault') {
    const { deviceId, fault, on } = await readBody(req);
    const ok = runner.setFault(String(deviceId), fault, !!on);
    return json(res, ok ? 200 : 404, { ok });
  }

  res.writeHead(404);
  res.end('not found');
});

await runner.start();
server.listen(PORT, () => {
  console.log(`\n  ▶ sim web panel  →  http://localhost:${PORT}`);
  console.log(`    broker ${BROKER}  kennel ${KENNEL || roster.devices[0]?.kennelId}\n`);
});

process.on('SIGINT', () => {
  runner.stop();
  bridge.end(true);
  process.exit(0);
});
