/**
 * LoadRunner — a scaled MQTT ingestion load test (hardening Phase 21, A12
 * #24), distinct from SimRunner's small hand-authored Scenarios. Where a
 * Scenario models *behavior* (jam, drift, a handful of realistic devices),
 * this models *volume*: N devices, connected on a staggered ramp (a
 * simultaneous connection storm isn't what 10k real devices reconnecting
 * over minutes/hours looks like, and would just test the broker's accept
 * queue rather than steady-state ingestion), each publishing retained
 * status once then periodic telemetry — no fault machinery, no commands.
 *
 * Reports connect success/failure and publish counts; the caller (CLI or a
 * CI job) applies pass/fail thresholds against the returned LoadResult.
 */
import mqtt, { type MqttClient } from 'mqtt';
import { buildTopic, DEVICE_TYPES, type DeviceType } from './protocol.js';

export interface LoadOptions {
  count: number;
  brokerUrl: string;
  username?: string;
  password?: string;
  /** kennels devices are spread across, round-robin — round-trips a multi-tenant fleet, not one giant kennel. */
  kennels?: number;
  /** telemetry publish interval per device. */
  tickMs?: number;
  /** spread all `count` connects evenly over this window instead of at once. */
  rampMs?: number;
  /** total run time, including the ramp. */
  durationMs: number;
  /** how long to wait for a single device's connect before counting it as failed. */
  connectTimeoutMs?: number;
  onLog?: (line: string) => void;
}

export interface LoadResult {
  requested: number;
  connected: number;
  connectFailed: number;
  connectP95Ms: number;
  ticksPublished: number;
  publishErrors: number;
  wallMs: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export class LoadRunner {
  private clients: MqttClient[] = [];
  private timers: NodeJS.Timeout[] = [];
  private log: (l: string) => void;

  constructor(private opts: LoadOptions) {
    this.log = opts.onLog ?? ((l) => console.log(l));
  }

  async run(): Promise<LoadResult> {
    const {
      count,
      brokerUrl,
      username,
      password,
      kennels = 10,
      tickMs = 30_000, // a real device reports on the order of 10s-60s, not every 5s at this scale
      rampMs = Math.min(120_000, count * 10), // ~10ms/device, capped at 2min
      durationMs,
      connectTimeoutMs = 10_000,
    } = this.opts;

    const start = Date.now();
    const connectMs: number[] = [];
    let connected = 0;
    let connectFailed = 0;
    let ticksPublished = 0;
    let publishErrors = 0;

    const stagger = count > 0 ? rampMs / count : 0;
    this.log(`▶ load: ${count} devices, ramp ${rampMs}ms, run ${durationMs}ms, tick ${tickMs}ms`);

    const connectOne = (i: number) =>
      new Promise<void>((resolve) => {
        const kennelId = `load-${i % kennels}`;
        const deviceType: DeviceType = DEVICE_TYPES[i % DEVICE_TYPES.length];
        const deviceId = `load-${deviceType}-${i}`;
        const statusTopic = buildTopic(kennelId, deviceType, deviceId, 'status');
        const attemptStart = Date.now();
        let settled = false;

        const client = mqtt.connect(brokerUrl, {
          clientId: `load-${deviceId}`,
          username,
          password,
          reconnectPeriod: 5000,
          connectTimeout: connectTimeoutMs,
          will: {
            topic: statusTopic,
            payload: JSON.stringify({ deviceId, kennelId, timestamp: 0, status: 'offline' }),
            qos: 1,
            retain: true,
          },
        });
        this.clients.push(client);

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          connectFailed++;
          resolve();
        }, connectTimeoutMs);

        client.once('connect', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          connected++;
          connectMs.push(Date.now() - attemptStart);
          client.publish(
            statusTopic,
            JSON.stringify({ deviceId, kennelId, timestamp: Date.now(), status: 'online' }),
            { qos: 1, retain: true },
          );
          const tick = setInterval(() => {
            const telemetryTopic = buildTopic(kennelId, deviceType, deviceId, 'telemetry');
            client.publish(
              telemetryTopic,
              JSON.stringify({ deviceId, kennelId, timestamp: Date.now(), value: Math.random() * 100 }),
              { qos: 1 },
              (err) => {
                if (err) publishErrors++;
                else ticksPublished++;
              },
            );
          }, tickMs);
          this.timers.push(tick);
          resolve();
        });

        client.on('error', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          connectFailed++;
          resolve();
        });
      });

    const connects: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      connects.push(
        new Promise((r) => {
          const t = setTimeout(() => connectOne(i).then(r), i * stagger);
          this.timers.push(t);
        }),
      );
    }
    await Promise.all(connects);
    this.log(`  connected ${connected}/${count} (${connectFailed} failed)`);

    const remaining = durationMs - (Date.now() - start);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

    this.stop();

    connectMs.sort((a, b) => a - b);
    return {
      requested: count,
      connected,
      connectFailed,
      connectP95Ms: percentile(connectMs, 95),
      ticksPublished,
      publishErrors,
      wallMs: Date.now() - start,
    };
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.clients.forEach((c) => c.end(true));
    this.clients = [];
  }
}
