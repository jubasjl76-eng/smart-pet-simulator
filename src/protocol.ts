/**
 * Smart Pet MQTT scheme — re-exported from the versioned contract package.
 *
 * Was a hand-vendored subset of `smart-pet-mqtt`; now a dependency on
 * `@jubasjl76-eng/mqtt-contract` (hardening Phase 11, ADR-0001). This file keeps
 * the local import path (`./protocol.js`) and the simulator's short type names
 * (`Command`, `Ack`) so nothing else in `src/` had to change.
 */
export { DEVICE_TYPES, buildTopic, deliveryFor, parseTopic } from '@jubasjl76-eng/mqtt-contract';
export type { DeviceType, TopicParts, Qos, Envelope } from '@jubasjl76-eng/mqtt-contract';
export type {
  CommandBase as Command,
  AckPayload as Ack,
} from '@jubasjl76-eng/mqtt-contract';
