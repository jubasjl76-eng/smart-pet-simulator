import { describe, it, expect } from 'vitest';
import { SCENARIOS, listScenarios } from '../scenarios.js';
import { parseTopic, buildTopic, deliveryFor } from '../protocol.js';

describe('scenarios', () => {
  it('every scenario has devices and a timeline, timeline is ordered', () => {
    for (const name of listScenarios()) {
      const s = SCENARIOS[name];
      expect(s.devices.length).toBeGreaterThan(0);
      expect(Array.isArray(s.timeline)).toBe(true);
      const times = s.timeline.map((t) => t.atMs);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it('every timeline step referencing a device names a real one', () => {
    for (const name of listScenarios()) {
      const s = SCENARIOS[name];
      const ids = new Set(s.devices.map((d) => d.deviceId));
      for (const step of s.timeline) {
        if (step.deviceId) expect(ids.has(step.deviceId)).toBe(true);
      }
    }
  });

  it('the canonical scenarios exist', () => {
    for (const n of ['happy-path', 'feeder-jam', 'offline-device', 'temp-spike', 'low-battery', 'wrong-dog']) {
      expect(listScenarios()).toContain(n);
    }
  });
});

describe('protocol helpers', () => {
  it('round-trips topics', () => {
    const t = buildTopic('home', 'feeder', 'feeder-01', 'status');
    expect(parseTopic(t)).toEqual({ kennelId: 'home', deviceType: 'feeder', deviceId: 'feeder-01', leaf: 'status' });
    expect(parseTopic('dogs/x/loc')).toBeNull();
  });
  it('delivery policy', () => {
    expect(deliveryFor('command')).toEqual({ qos: 2, retain: false });
    expect(deliveryFor('status')).toEqual({ qos: 1, retain: true });
    expect(deliveryFor('temperature')).toEqual({ qos: 1, retain: false });
  });
});
