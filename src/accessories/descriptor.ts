import type { ConfiguredPool } from '../config.js';
import type { PoolConfiguration } from '../api/types.js';
import { ACCESSORY_CONTEXT_VERSION } from '../settings.js';

export type AccessoryKind =
  | 'system'
  | 'heater'
  | 'solar'
  | 'channel'
  | 'valve'
  | 'lighting'
  | 'favourite';

export interface AccessoryDescriptor {
  poolId: string;
  kind: AccessoryKind;
  deviceNumber: number;
  displayName: string;
  model: string;
  vendorName: string;
}

export interface ConnectMyPoolAccessoryContext {
  [key: string]: unknown;
  schemaVersion: typeof ACCESSORY_CONTEXT_VERSION;
  descriptor: AccessoryDescriptor;
}

const CHANNEL_FUNCTIONS = new Map<number, string>([
  [1, 'Filter Pump'],
  [2, 'Cleaning Pump'],
  [3, 'Heater Pump'],
  [4, 'Booster Pump'],
  [5, 'Waterfall Pump'],
  [6, 'Fountain Pump'],
  [7, 'Spa Pump'],
  [8, 'Solar Pump'],
  [9, 'Blower'],
  [10, 'Swimjet'],
  [11, 'Jets'],
  [12, 'Spa Jets'],
  [13, 'Overflow'],
  [14, 'Spillway'],
  [15, 'Audio'],
  [16, 'Hot Seat'],
  [17, 'Heater Power'],
  [18, 'Custom Channel'],
]);

const VALVE_FUNCTIONS = new Map<number, string>([
  [1, 'Pool/Spa Valve'],
  [2, 'Solar Valve'],
]);

export function buildAccessoryDescriptors(
  pool: ConfiguredPool,
  configuration: PoolConfiguration,
): AccessoryDescriptor[] {
  const descriptors: AccessoryDescriptor[] = [
    {
      poolId: pool.id,
      kind: 'system',
      deviceNumber: 0,
      displayName: pool.name,
      model: 'ConnectMyPool System',
      vendorName: pool.name,
    },
  ];

  if (pool.expose.heaters && configuration.has_heaters) {
    descriptors.push(
      ...configuration.heaters.map(({ heater_number: deviceNumber }) => ({
        poolId: pool.id,
        kind: 'heater' as const,
        deviceNumber,
        displayName: `${pool.name} Heater ${deviceNumber}`,
        model: 'Pool Heater',
        vendorName: `Heater ${deviceNumber}`,
      })),
    );
  }

  if (pool.expose.solar && configuration.has_solar_systems) {
    descriptors.push(
      ...configuration.solar_systems.map(({ solar_number: deviceNumber }) => ({
        poolId: pool.id,
        kind: 'solar' as const,
        deviceNumber,
        displayName: `${pool.name} Solar ${deviceNumber}`,
        model: 'Solar Heater',
        vendorName: `Solar ${deviceNumber}`,
      })),
    );
  }

  if (pool.expose.channels && configuration.has_channels) {
    descriptors.push(
      ...configuration.channels.map((channel) => ({
        poolId: pool.id,
        kind: 'channel' as const,
        deviceNumber: channel.channel_number,
        displayName: `${pool.name} Next ${channel.name} Mode`,
        model: CHANNEL_FUNCTIONS.get(channel.function) ?? `Channel Function ${channel.function}`,
        vendorName: channel.name,
      })),
    );
  }

  if (pool.expose.valves && configuration.has_valves) {
    descriptors.push(
      ...configuration.valves.map((valve) => ({
        poolId: pool.id,
        kind: 'valve' as const,
        deviceNumber: valve.valve_number,
        displayName: `${pool.name} ${valve.name}`,
        model: VALVE_FUNCTIONS.get(valve.function) ?? `Valve Function ${valve.function}`,
        vendorName: valve.name,
      })),
    );
  }

  if (pool.expose.lighting && configuration.has_lighting_zones) {
    descriptors.push(
      ...configuration.lighting_zones.map((zone) => ({
        poolId: pool.id,
        kind: 'lighting' as const,
        deviceNumber: zone.lighting_zone_number,
        displayName: `${pool.name} ${zone.name}`,
        model: zone.color_enabled ? 'Colour Lighting Zone' : 'Lighting Zone',
        vendorName: zone.name,
      })),
    );
  }

  if (pool.expose.favourites && configuration.has_favourites) {
    descriptors.push(
      ...configuration.favourites.map((favourite) => ({
        poolId: pool.id,
        kind: 'favourite' as const,
        deviceNumber: favourite.favourite_number,
        displayName: `${pool.name} ${favourite.name}`,
        model: 'Pool Favourite',
        vendorName: favourite.name,
      })),
    );
  }

  return descriptors;
}

export function accessoryIdentity(descriptor: AccessoryDescriptor): string {
  return `connect-my-pool:${descriptor.poolId}:${descriptor.kind}:${descriptor.deviceNumber}`;
}

export function isAccessoryContext(value: unknown): value is ConnectMyPoolAccessoryContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== ACCESSORY_CONTEXT_VERSION) {
    return false;
  }
  const descriptor = record.descriptor;
  if (typeof descriptor !== 'object' || descriptor === null) {
    return false;
  }
  const candidate = descriptor as Record<string, unknown>;
  return (
    typeof candidate.poolId === 'string'
    && typeof candidate.kind === 'string'
    && typeof candidate.deviceNumber === 'number'
    && typeof candidate.displayName === 'string'
    && typeof candidate.model === 'string'
    && typeof candidate.vendorName === 'string'
  );
}
