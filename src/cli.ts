#!/usr/bin/env node
/**
 * smart-pet-simulator — a virtual kennel on MQTT.
 *
 *   smart-pet-sim --scenario feeder-jam --broker mqtt://localhost:1883
 *   smart-pet-sim --list
 *
 * Options:
 *   --scenario <name>   scenario to run (default: happy-path)
 *   --broker <url>      MQTT broker (default: $MQTT_URL or mqtt://localhost:1883)
 *   --kennel <id>       override kennelId for all devices (default: from scenario)
 *   --tick <ms>         telemetry interval (default 5000)
 *   --duration <ms>     stop after N ms (default: run until Ctrl-C)
 *   --list              print scenarios and exit
 */
import { SCENARIOS, listScenarios } from './scenarios.js';
import { SimRunner } from './runner.js';

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
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
