/**
 * VirtualDevice — a pure state machine for one simulated device.
 *
 * The runner owns MQTT; this class owns behaviour. Everything here is
 * deterministic given its inputs, so it is unit-tested without a broker.
 *
 *   applyCommand(cmd)  → { ack, statusPatch?, events[] }
 *   tick(now)          → { statusPatch?, metrics?, events[] }   (drift / schedules / faults)
 *   injectFault(name)  → flips a fault flag the behaviour reads
 */
import type { Command, Ack, DeviceType } from './protocol.js';

export interface DeviceEvent {
  event: string;
  data?: Record<string, unknown>;
}

export interface StepResult {
  ack?: Ack;
  statusPatch?: Record<string, unknown>;
  /** single-metric leaves to publish, e.g. { temperature: 30.2 } */
  metrics?: Record<string, number>;
  events: DeviceEvent[];
}

export interface DeviceSpec {
  deviceId: string;
  deviceType: DeviceType;
  kennelId: string;
  /** starting status fields */
  initial?: Record<string, unknown>;
}

export type FaultName =
  | 'jam'          // feeder won't dispense
  | 'offline'      // stops publishing / responding
  | 'no_flow'      // water pump runs but level doesn't move
  | 'stuck_door'   // door won't actuate
  | 'drift_high'   // sensor climbs out of range
  | 'battery_drain'; // gps battery falls fast

export abstract class VirtualDevice {
  readonly deviceId: string;
  readonly deviceType: DeviceType;
  readonly kennelId: string;
  status: Record<string, unknown>;
  faults = new Set<FaultName>();
  online = true;

  constructor(spec: DeviceSpec) {
    this.deviceId = spec.deviceId;
    this.deviceType = spec.deviceType;
    this.kennelId = spec.kennelId;
    this.status = { status: 'online', fw: 'sim-1.0.0', ...(spec.initial ?? {}) };
  }

  injectFault(name: FaultName): void {
    this.faults.add(name);
    if (name === 'offline') this.online = false;
  }
  clearFault(name: FaultName): void {
    this.faults.delete(name);
    if (name === 'offline') this.online = true;
  }

  protected ok(cmd: Command, detail?: string): Ack {
    return this.ackFor(cmd, 'ok', detail);
  }
  protected err(cmd: Command, detail: string): Ack {
    return this.ackFor(cmd, 'error', detail);
  }
  protected ackFor(cmd: Command, result: Ack['result'], detail?: string): Ack {
    return {
      deviceId: this.deviceId, kennelId: this.kennelId, timestamp: Date.now(),
      ackId: cmd.id ?? '', command: cmd.command, result, detail,
    };
  }

  /** Merge a patch into status and echo the merged object. */
  protected patch(p: Record<string, unknown>): Record<string, unknown> {
    this.status = { ...this.status, ...p };
    return p;
  }

  abstract applyCommand(cmd: Command): StepResult;
  abstract tick(now: Date): StepResult;

  /** Full retained status payload. */
  snapshot(): Record<string, unknown> {
    return {
      deviceId: this.deviceId, kennelId: this.kennelId, timestamp: Date.now(),
      ...this.status,
      status: this.online ? (this.status.status ?? 'online') : 'offline',
    };
  }
}

export const NO_OP: StepResult = { events: [] };
