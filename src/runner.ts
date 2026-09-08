/**
 * Runner — plays a Scenario against a real MQTT broker.
 *
 * Per device:
 *   - connects with an LWT on …/status  ({timestamp:0,status:"offline"} retained)
 *   - publishes a retained status snapshot
 *   - subscribes …/command, runs applyCommand(), publishes ack + status + events
 *   - every tickMs publishes telemetry (sensor metrics, gps location, water level)
 * Plus the scenario timeline (fault inject/clear) on a wall clock.
 */
import mqtt, { type MqttClient } from 'mqtt';
import { buildTopic, deliveryFor, type Command } from './protocol.js';
import { createDevice } from './devices/index.js';
import { GpsSim } from './devices/index.js';
import type { VirtualDevice } from './device.js';
import type { Scenario } from './scenarios.js';

export interface RunnerOptions {
  brokerUrl: string;
  username?: string;
  password?: string;
  tickMs?: number;
  durationMs?: number;
  onLog?: (line: string) => void;
}

export class SimRunner {
  private clients: MqttClient[] = [];
  private devices = new Map<string, VirtualDevice>();
  private timers: NodeJS.Timeout[] = [];
  private log: (l: string) => void;

  constructor(private scenario: Scenario, private opts: RunnerOptions) {
    this.log = opts.onLog ?? ((l) => console.log(l));
  }

  async start(): Promise<void> {
    const tickMs = this.opts.tickMs ?? 5000;
    this.log(`▶ scenario "${this.scenario.name}" — ${this.scenario.description}`);

    for (const spec of this.scenario.devices) {
      const dev = createDevice(spec);
      this.devices.set(dev.deviceId, dev);

      const statusTopic = buildTopic(dev.kennelId, dev.deviceType, dev.deviceId, 'status');
      const client = mqtt.connect(this.opts.brokerUrl, {
        clientId: `sim-${dev.deviceId}`,
        username: this.opts.username,
        password: this.opts.password,
        reconnectPeriod: 3000,
        will: { topic: statusTopic, payload: JSON.stringify({ deviceId: dev.deviceId, kennelId: dev.kennelId, timestamp: 0, status: 'offline' }), qos: 1, retain: true },
      });
      this.clients.push(client);

      client.on('connect', () => {
        const cmdTopic = buildTopic(dev.kennelId, dev.deviceType, dev.deviceId, 'command');
        client.subscribe(cmdTopic, { qos: 1 });
        this.publishStatus(client, dev);
        this.log(`  ✓ ${dev.deviceId} (${dev.deviceType}) online`);
      });

      client.on('message', (_t, payload) => {
        let cmd: Command;
        try { cmd = JSON.parse(payload.toString()); } catch { return; }
        if (!dev.online) return; // offline device ignores commands
        const r = dev.applyCommand(cmd);
        if (r.ack) this.pub(client, dev, 'ack', r.ack);
        for (const e of r.events) this.pub(client, dev, 'event', { deviceId: dev.deviceId, kennelId: dev.kennelId, timestamp: Date.now(), ...e });
        if (r.statusPatch) this.publishStatus(client, dev);
        this.log(`  → ${dev.deviceId} ${cmd.command} ⇒ ${r.ack?.result ?? 'no-ack'}`);
      });
    }

    // telemetry tick
    this.timers.push(setInterval(() => this.tickAll(tickMs), tickMs));

    // scenario timeline
    for (const step of this.scenario.timeline) {
      this.timers.push(setTimeout(() => this.runStep(step), step.atMs));
    }

    if (this.opts.durationMs) {
      this.timers.push(setTimeout(() => this.stop(), this.opts.durationMs));
    }
  }

  private tickAll(_tickMs: number): void {
    const now = new Date();
    this.scenario.devices.forEach((spec, i) => {
      const dev = this.devices.get(spec.deviceId);
      const client = this.clients[i];
      if (!dev || !client || !client.connected || !dev.online) return;
      const r = dev.tick(now);
      for (const [metric, value] of Object.entries(r.metrics ?? {})) {
        this.pub(client, dev, metric, { deviceId: dev.deviceId, kennelId: dev.kennelId, timestamp: Date.now(), value, unit: metric === 'temperature' ? 'celsius' : undefined });
      }
      if (dev instanceof GpsSim) {
        this.pub(client, dev, 'location', { deviceId: dev.deviceId, kennelId: dev.kennelId, timestamp: Date.now(), ...dev.location() });
      }
      for (const e of r.events) this.pub(client, dev, 'event', { deviceId: dev.deviceId, kennelId: dev.kennelId, timestamp: Date.now(), ...e });
      if (r.statusPatch) this.publishStatus(client, dev);
    });
  }

  private runStep(step: import('./scenarios.js').TimelineStep): void {
    this.log(`  ⏱  +${step.atMs}ms  ${step.note}${step.expect ? `  (expect: ${step.expect})` : ''}`);
    if (!step.deviceId) return;
    const dev = this.devices.get(step.deviceId);
    if (!dev) return;
    if (step.fault) dev.injectFault(step.fault);
    if (step.clearFault) dev.clearFault(step.clearFault);
    const client = this.clients[this.scenario.devices.findIndex((s) => s.deviceId === step.deviceId)];
    if (client?.connected) this.publishStatus(client, dev);
  }

  private publishStatus(client: MqttClient, dev: VirtualDevice): void {
    this.pub(client, dev, 'status', dev.snapshot());
  }

  private pub(client: MqttClient, dev: VirtualDevice, leaf: string, body: unknown): void {
    if (leaf === 'status' && !dev.online) {
      body = { deviceId: dev.deviceId, kennelId: dev.kennelId, timestamp: 0, status: 'offline' };
    }
    const topic = buildTopic(dev.kennelId, dev.deviceType, dev.deviceId, leaf);
    const { qos, retain } = deliveryFor(leaf);
    client.publish(topic, JSON.stringify(body), { qos, retain });
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.clients.forEach((c) => c.end(true));
    this.clients = [];
    this.log('■ scenario stopped');
  }
}
