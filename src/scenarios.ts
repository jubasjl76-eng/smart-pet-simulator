/**
 * Scenarios — a set of virtual devices plus a timeline of faults/events.
 * The runner plays the timeline against a real broker; tests play it in memory.
 */
import type { DeviceSpec, FaultName } from './device.js';

export interface TimelineStep {
  atMs: number;
  /** human note shown in the runner log */
  note: string;
  deviceId?: string;
  fault?: FaultName;
  clearFault?: FaultName;
  /** an expectation the operator/CI should see downstream (informational) */
  expect?: string;
}

export interface Scenario {
  name: string;
  description: string;
  devices: DeviceSpec[];
  timeline: TimelineStep[];
}

const KENNEL = 'home';

function d(deviceId: string, deviceType: DeviceSpec['deviceType'], initial?: Record<string, unknown>): DeviceSpec {
  return { deviceId, deviceType, kennelId: KENNEL, initial };
}

const BASE_DEVICES: DeviceSpec[] = [
  d('feeder-01', 'feeder', { foodLevel: 65 }),
  d('water-01', 'water', { waterLevel: 70 }),
  d('door-pen-3', 'door'),
  d('sensor-whelp-1', 'sensor', { temperature: 24 }),
  d('gps-collar-01', 'gps', { battery: 82 }),
  d('scale-bowl-1', 'scale'),
];

export const SCENARIOS: Record<string, Scenario> = {
  'happy-path': {
    name: 'happy-path',
    description: 'All devices healthy; steady telemetry, feed/dispense round-trip cleanly.',
    devices: BASE_DEVICES,
    timeline: [
      { atMs: 0, note: 'all devices online', expect: 'backend shows 6 devices online' },
    ],
  },

  'feeder-jam': {
    name: 'feeder-jam',
    description: 'feeder-01 jams; the next feed command errors and emits a jam event.',
    devices: BASE_DEVICES,
    timeline: [
      { atMs: 5_000, note: 'inject jam on feeder-01', deviceId: 'feeder-01', fault: 'jam',
        expect: 'feed → ack:error + kennel/home/feeder/feeder-01/event {event:"jam"} → care-inbox exception' },
      { atMs: 40_000, note: 'clear jam', deviceId: 'feeder-01', clearFault: 'jam' },
    ],
  },

  'offline-device': {
    name: 'offline-device',
    description: 'water-01 drops off the network; LWT fires; comes back after 30s.',
    devices: BASE_DEVICES,
    timeline: [
      { atMs: 8_000, note: 'water-01 goes offline', deviceId: 'water-01', fault: 'offline',
        expect: 'retained status → {status:"offline"}; backend offline detector raises device-offline' },
      { atMs: 38_000, note: 'water-01 returns', deviceId: 'water-01', clearFault: 'offline' },
    ],
  },

  'temp-spike': {
    name: 'temp-spike',
    description: 'Whelping-room sensor drifts above 30 °C, then recovers.',
    devices: BASE_DEVICES,
    timeline: [
      { atMs: 5_000, note: 'sensor-whelp-1 drift high', deviceId: 'sensor-whelp-1', fault: 'drift_high',
        expect: 'temperature > 30 → rule fires → relay:fan on + critical exception' },
      { atMs: 60_000, note: 'drift cleared', deviceId: 'sensor-whelp-1', clearFault: 'drift_high' },
    ],
  },

  'low-battery': {
    name: 'low-battery',
    description: 'gps-collar-01 battery drains fast and crosses the low threshold.',
    devices: BASE_DEVICES,
    timeline: [
      { atMs: 3_000, note: 'battery drain on gps-collar-01', deviceId: 'gps-collar-01', fault: 'battery_drain',
        expect: 'location.battery < 15 → low_battery event → low-battery exception' },
    ],
  },

  'wrong-dog': {
    name: 'wrong-dog',
    description: 'A second collar tag appears at feeder-01 (wrong dog in the pen).',
    devices: [...BASE_DEVICES, d('gps-collar-09', 'gps', { battery: 60 })],
    timeline: [
      { atMs: 6_000, note: 'feeder-01 reports presence tag-09 instead of its assigned tag-01',
        deviceId: 'feeder-01',
        expect: 'kennel/home/feeder/feeder-01/presence {tagId:"tag-09"} → wrong-pen critical exception' },
    ],
  },
};

export function listScenarios(): string[] {
  return Object.keys(SCENARIOS);
}
