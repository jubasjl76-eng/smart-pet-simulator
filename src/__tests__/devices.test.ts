import { describe, it, expect } from 'vitest';
import { createDevice, FeederSim, GpsSim } from '../devices/index.js';
import type { Command } from '../protocol.js';

const cmd = (command: string, params?: Record<string, unknown>): Command => ({
  command, id: 'c1', deviceId: 'x', kennelId: 'home', timestamp: Date.now(), params,
});

describe('FeederSim', () => {
  it('feeds: ack ok, level drops, fed event', () => {
    const f = new FeederSim({ deviceId: 'feeder-01', deviceType: 'feeder', kennelId: 'home', initial: { foodLevel: 50 } });
    const r = f.applyCommand(cmd('feed', { amount: 40 }));
    expect(r.ack?.result).toBe('ok');
    expect(r.events[0].event).toBe('fed');
    expect(Number(f.status.foodLevel)).toBeLessThan(50);
  });

  it('jam fault: feed errors + jam event + jammed status', () => {
    const f = new FeederSim({ deviceId: 'f', deviceType: 'feeder', kennelId: 'home' });
    f.injectFault('jam');
    const r = f.applyCommand(cmd('feed', { amount: 40 }));
    expect(r.ack?.result).toBe('error');
    expect(r.events[0].event).toBe('jam');
    expect(f.status.jammed).toBe(true);
  });

  it('rejects unknown commands', () => {
    const f = new FeederSim({ deviceId: 'f', deviceType: 'feeder', kennelId: 'home' });
    expect(f.applyCommand(cmd('launch')).ack?.result).toBe('rejected');
  });
});

describe('WaterSim', () => {
  it('dispense moves the level; no_flow fault errors', () => {
    const w = createDevice({ deviceId: 'w1', deviceType: 'water', kennelId: 'home', initial: { waterLevel: 40 } });
    const ok = w.applyCommand(cmd('dispense', { seconds: 5 }));
    expect(ok.ack?.result).toBe('ok');
    w.injectFault('no_flow');
    const bad = w.applyCommand(cmd('dispense', { seconds: 5 }));
    expect(bad.ack?.result).toBe('error');
    expect(bad.events[0].event).toBe('no_flow');
  });

  it('tick drains level and reports metrics', () => {
    const w = createDevice({ deviceId: 'w1', deviceType: 'water', kennelId: 'home', initial: { waterLevel: 21 } });
    const r = w.tick(new Date());
    expect(r.metrics).toHaveProperty('level');
    expect(Number(w.status.waterLevel)).toBeLessThan(21);
  });
});

describe('DoorSim', () => {
  it('unlock/open/close set state and emit events', () => {
    const d = createDevice({ deviceId: 'door-3', deviceType: 'door', kennelId: 'home' });
    const open = d.applyCommand(cmd('door', { action: 'open', reason: 'emergency:fire' }));
    expect(open.ack?.result).toBe('ok');
    expect(d.status.open).toBe(true);
    expect(open.events[0].event).toBe('door_open');
    const close = d.applyCommand(cmd('door', { action: 'close' }));
    expect(d.status.locked).toBe(true);
    expect(close.events[0].event).toBe('door_closed');
  });

  it('stuck_door fault errors', () => {
    const d = createDevice({ deviceId: 'door-3', deviceType: 'door', kennelId: 'home' });
    d.injectFault('stuck_door');
    expect(d.applyCommand(cmd('door', { action: 'open' })).ack?.result).toBe('error');
  });
});

describe('SensorSim', () => {
  it('drift_high pushes temperature up each tick', () => {
    const s = createDevice({ deviceId: 's1', deviceType: 'sensor', kennelId: 'home', initial: { temperature: 24 } });
    s.injectFault('drift_high');
    const before = Number(s.status.temperature);
    s.tick(new Date());
    s.tick(new Date());
    expect(Number(s.status.temperature)).toBeGreaterThan(before);
  });
});

describe('GpsSim', () => {
  it('battery_drain crosses the low threshold and emits low_battery', () => {
    const g = createDevice({ deviceId: 'c1', deviceType: 'gps', kennelId: 'home', initial: { battery: 16 } }) as GpsSim;
    g.injectFault('battery_drain');
    const r = g.tick(new Date());
    expect(Number(g.status.battery)).toBeLessThan(16);
    expect(r.events.some((e) => e.event === 'low_battery')).toBe(true);
    expect(g.location()).toHaveProperty('latitude');
  });
});

describe('offline behaviour', () => {
  it('snapshot reports offline and online flag flips', () => {
    const f = createDevice({ deviceId: 'f', deviceType: 'feeder', kennelId: 'home' });
    f.injectFault('offline');
    expect(f.online).toBe(false);
    expect(f.snapshot().status).toBe('offline');
    f.clearFault('offline');
    expect(f.online).toBe(true);
  });
});
