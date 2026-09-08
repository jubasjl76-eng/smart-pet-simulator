import { VirtualDevice, type DeviceSpec, type StepResult } from '../device.js';
import type { Command, DeviceType } from '../protocol.js';

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export class FeederSim extends VirtualDevice {
  constructor(spec: DeviceSpec) {
    super({ ...spec, initial: { foodLevel: 80, isFoodLow: false, jammed: false, lastFeed: 0, ...spec.initial } });
  }
  applyCommand(cmd: Command): StepResult {
    if (cmd.command === 'feed') {
      if (this.faults.has('jam')) {
        this.patch({ jammed: true });
        return { ack: this.err(cmd, 'servo jam'), statusPatch: { jammed: true }, events: [{ event: 'jam' }] };
      }
      const amount = num(cmd.params?.amount, 40);
      const level = clamp(num(this.status.foodLevel, 80) - amount / 20, 0, 100);
      const p = this.patch({ foodLevel: level, isFoodLow: level < 20, lastFeed: Date.now() });
      return { ack: this.ok(cmd), statusPatch: p, events: [{ event: 'fed', data: { amount } }] };
    }
    if (cmd.command === 'schedule_set') {
      return { ack: this.ok(cmd), events: [] };
    }
    return { ack: this.ackFor(cmd, 'rejected', 'unknown command'), events: [] };
  }
  tick(): StepResult {
    // slow settling / no drift
    return { events: [] };
  }
}

export class WaterSim extends VirtualDevice {
  constructor(spec: DeviceSpec) {
    super({ ...spec, initial: { waterLevel: 75, tds: 120, temperature: 21, ...spec.initial } });
  }
  applyCommand(cmd: Command): StepResult {
    if (cmd.command === 'dispense') {
      const secs = num(cmd.params?.seconds, 5);
      const drop = this.faults.has('no_flow') ? 0 : secs * 1.5;
      const level = clamp(num(this.status.waterLevel, 75) + drop - secs * 0.2, 0, 100);
      const p = this.patch({ waterLevel: level, isLowWater: level < 20 });
      const events = this.faults.has('no_flow') ? [{ event: 'no_flow' as const }] : [{ event: 'dispensed', data: { seconds: secs } }];
      return { ack: this.faults.has('no_flow') ? this.err(cmd, 'no flow') : this.ok(cmd), statusPatch: p, events };
    }
    return { ack: this.ackFor(cmd, 'rejected', 'unknown command'), events: [] };
  }
  tick(): StepResult {
    const level = clamp(num(this.status.waterLevel, 75) - 0.3, 0, 100);
    const p = this.patch({ waterLevel: level, isLowWater: level < 20 });
    return { statusPatch: p, metrics: { level, tds: num(this.status.tds, 120) }, events: [] };
  }
}

export class DoorSim extends VirtualDevice {
  constructor(spec: DeviceSpec) {
    super({ ...spec, initial: { locked: true, open: false, lastReason: 'boot', ...spec.initial } });
  }
  applyCommand(cmd: Command): StepResult {
    if (cmd.command !== 'door') return { ack: this.ackFor(cmd, 'rejected', 'unknown command'), events: [] };
    if (this.faults.has('stuck_door')) return { ack: this.err(cmd, 'actuator stuck'), events: [{ event: 'tamper' }] };
    const action = String(cmd.params?.action ?? 'noop');
    const reason = String(cmd.params?.reason ?? '');
    if (action === 'noop') return { ack: this.ok(cmd), events: [] };
    const locked = action === 'lock' || action === 'close';
    const open = action === 'open';
    const p = this.patch({ locked, open, lastReason: reason || action });
    return { ack: this.ok(cmd), statusPatch: p, events: [{ event: open ? 'door_open' : 'door_closed', data: { reason } }] };
  }
  tick(): StepResult { return { events: [] }; }
}

export class SensorSim extends VirtualDevice {
  private base: number;
  constructor(spec: DeviceSpec) {
    super({ ...spec, initial: { temperature: 22, humidity: 55, airquality: 40, ...spec.initial } });
    this.base = num(this.status.temperature, 22);
  }
  applyCommand(cmd: Command): StepResult { return { ack: this.ackFor(cmd, 'rejected', 'sensor takes no commands'), events: [] }; }
  tick(now: Date): StepResult {
    let t = num(this.status.temperature, this.base);
    if (this.faults.has('drift_high')) t += 0.8;
    else t = this.base + Math.sin(now.getTime() / 3_600_000) * 1.5;
    const h = clamp(num(this.status.humidity, 55) + (Math.random() - 0.5), 20, 90);
    this.patch({ temperature: Number(t.toFixed(2)), humidity: Number(h.toFixed(1)) });
    return {
      metrics: { temperature: num(this.status.temperature), humidity: num(this.status.humidity), airquality: num(this.status.airquality, 40) },
      events: [],
    };
  }
}

export class GpsSim extends VirtualDevice {
  private lat: number; private lng: number;
  constructor(spec: DeviceSpec) {
    super({ ...spec, initial: { battery: 90, fix: true, ...spec.initial } });
    this.lat = num((spec.initial as any)?.latitude, 40.4168);
    this.lng = num((spec.initial as any)?.longitude, -3.7038);
  }
  applyCommand(cmd: Command): StepResult {
    if (cmd.command === 'set_interval') return { ack: this.ok(cmd), events: [] };
    if (cmd.command === 'get_location') return { ack: this.ok(cmd), events: [], metrics: {} };
    return { ack: this.ackFor(cmd, 'rejected', 'unknown command'), events: [] };
  }
  tick(): StepResult {
    this.lat += (Math.random() - 0.5) * 0.0003;
    this.lng += (Math.random() - 0.5) * 0.0003;
    const drain = this.faults.has('battery_drain') ? 2 : 0.1;
    const battery = clamp(num(this.status.battery, 90) - drain, 0, 100);
    this.patch({ battery });
    return {
      statusPatch: { battery },
      // location is published by the runner from these fields
      metrics: {},
      events: battery < 15 ? [{ event: 'low_battery', data: { battery } }] : [],
    };
  }
  location(): Record<string, number | boolean> {
    return { latitude: Number(this.lat.toFixed(6)), longitude: Number(this.lng.toFixed(6)), battery: num(this.status.battery, 90), fix: true, accuracy: 6 };
  }
}

export class ScaleSim extends VirtualDevice {
  constructor(spec: DeviceSpec) {
    super({ ...spec, initial: { grams: 0, ...spec.initial } });
  }
  applyCommand(cmd: Command): StepResult {
    if (cmd.command === 'tare') { this.patch({ grams: 0 }); return { ack: this.ok(cmd), events: [] }; }
    if (cmd.command === 'mark_meal') return { ack: this.ok(cmd), events: [] };
    if (cmd.command === 'measure_consumed') {
      const eaten = num(cmd.params?.grams, 30);
      return { ack: this.ok(cmd), events: [{ event: 'consumed', data: { grams: eaten } }] };
    }
    return { ack: this.ackFor(cmd, 'rejected', 'unknown command'), events: [] };
  }
  tick(): StepResult { return { events: [] }; }
}

const REGISTRY: Record<DeviceType, new (s: DeviceSpec) => VirtualDevice> = {
  feeder: FeederSim, water: WaterSim, door: DoorSim, sensor: SensorSim,
  gps: GpsSim, scale: ScaleSim,
  camera: SensorSim, hub: SensorSim, // placeholders; not simulated in v1
};

export function createDevice(spec: DeviceSpec): VirtualDevice {
  const Ctor = REGISTRY[spec.deviceType];
  if (!Ctor) throw new Error(`No simulator for device type ${spec.deviceType}`);
  return new Ctor(spec);
}
