/**
 * Canonical Smart Pet MQTT scheme — vendored subset.
 * Source of truth: smart-pet-mqtt/src/{topics,payloads}.ts.
 *
 *   kennel/{kennelId}/{deviceType}/{deviceId}/{leaf}
 */
export const DEVICE_TYPES = ['feeder', 'water', 'door', 'sensor', 'gps', 'camera', 'scale', 'hub'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export type Qos = 0 | 1 | 2;
export interface Delivery { qos: Qos; retain: boolean; }

export function deliveryFor(leaf: string): Delivery {
  if (leaf === 'command') return { qos: 2, retain: false };
  if (leaf === 'status') return { qos: 1, retain: true };
  return { qos: 1, retain: false };
}

export function buildTopic(kennelId: string, deviceType: string, deviceId: string, leaf: string): string {
  return `kennel/${kennelId}/${deviceType}/${deviceId}/${leaf}`;
}

export interface TopicParts { kennelId: string; deviceType: DeviceType; deviceId: string; leaf: string; }

export function parseTopic(topic: string): TopicParts | null {
  const p = topic.split('/');
  if (p.length !== 5 || p[0] !== 'kennel') return null;
  if (!(DEVICE_TYPES as readonly string[]).includes(p[2])) return null;
  return { kennelId: p[1], deviceType: p[2] as DeviceType, deviceId: p[3], leaf: p[4] };
}

export interface Envelope { deviceId: string; kennelId: string; timestamp: number; }

export interface Command extends Envelope {
  command: string;
  id?: string;
  params?: Record<string, unknown>;
}

export interface Ack extends Envelope {
  ackId: string;
  command: string;
  result: 'ok' | 'error' | 'rejected' | 'queued';
  detail?: string;
}

export function envelope(deviceId: string, kennelId: string): Envelope {
  return { deviceId, kennelId, timestamp: Date.now() };
}
