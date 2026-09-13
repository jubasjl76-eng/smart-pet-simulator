#!/usr/bin/env node
/**
 * smart-pet-simulator — a virtual kennel on MQTT.
 *
 *   smart-pet-sim --scenario feeder-jam --broker mqtt://localhost:1883
 *   smart-pet-sim --list
 *   smart-pet-sim --load --count 10000 --broker mqtt://staging:1883
 *
 * Options:
 *   --scenario <name>   scenario to run (default: happy-path)
 *   --broker <url>      MQTT broker (default: $MQTT_URL or mqtt://localhost:1883)
 *   --kennel <id>       override kennelId for all devices (default: from scenario)
 *   --tick <ms>         telemetry interval (default 5000)
 *   --duration <ms>     stop after N ms (default: run until Ctrl-C)
 *   --list              print scenarios and exit
 *
 * Load mode (hardening Phase 21, A12 #24) — a scaled ingestion test, not a
 * behavioral Scenario:
 *   --load                  switch to load mode
 *   --count <n>             devices to simulate (default 10000)
 *   --ramp <ms>             spread connects over this window (default: ~10ms/device, capped 2min)
 *   --duration <ms>         total run time (default 300000)
 *   --tick <ms>             telemetry interval per device (default 30000)
 *   --kennels <n>           spread devices round-robin across N kennels (default 10)
 *   --min-connect-rate <p>  fail (exit 1) if connected/requested < p, e.g. 0.99 (default 0.99)
 */
import { SCENARIOS, listScenarios } from './scenarios.js';
import { SimRunner } from './runner.js';
import { LoadRunner } from './load.js';

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function runLoad() {
  const count = Number(arg('count', '10000'));
  const durationMs = Number(arg('duration', '300000'));
  const minConnectRate = Number(arg('min-connect-rate', '0.99'));
  const runner = new LoadRunner({
    count,
    durationMs,
    brokerUrl: arg('broker', process.env.MQTT_URL || 'mqtt://localhost:1883')!,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    kennels: arg('kennels') ? Number(arg('kennels')) : undefined,
    tickMs: arg('tick') ? Number(arg('tick')) : undefined,
    rampMs: arg('ramp') ? Number(arg('ramp')) : undefined,
  });
  process.on('SIGINT', () => { runner.stop(); process.exit(0); });

  const result = await runner.run();
  console.log(JSON.stringify(result, null, 2));

  const connectRate = result.requested > 0 ? result.connected / result.requested : 0;
  if (connectRate < minConnectRate) {
    console.error(`FAIL: connect rate ${(connectRate * 100).toFixed(2)}% < required ${(minConnectRate * 100).toFixed(2)}%`);
    process.exit(1);
  }
  if (result.publishErrors > 0) {
    console.error(`FAIL: ${result.publishErrors} publish errors`);
    process.exit(1);
  }
  console.log('PASS');
}

async function main() {
  if (has('load')) {
    await runLoad();
    return;
  }

  if (has('list') || has('help')) {
    console.log('Scenarios:');
    for (const n of listScenarios()) console.log(`  ${n.padEnd(16)} ${SCENARIOS[n].description}`);
    return;
  }

  const scenarioName = arg('scenario', 'happy-path')!;
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    console.error(`Unknown scenario "${scenarioName}". Try --list.`);
    process.exit(1);
  }

  const kennel = arg('kennel');
  if (kennel) {
    scenario.devices = scenario.devices.map((d) => ({ ...d, kennelId: kennel }));
  }

  const runner = new SimRunner(scenario, {
    brokerUrl: arg('broker', process.env.MQTT_URL || 'mqtt://localhost:1883')!,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    tickMs: Number(arg('tick', '5000')),
    durationMs: arg('duration') ? Number(arg('duration')) : undefined,
  });

  process.on('SIGINT', () => { runner.stop(); process.exit(0); });
  await runner.start();
}

main().catch((e) => { console.error(e); process.exit(1); });
