import type {
  ApiFailure,
  PoolActionResponse,
  PoolActionStatusResponse,
  PoolConfiguration,
  PoolStatus,
} from './types.js';

export class InvalidApiResponseError extends Error {
  constructor(endpoint: string, detail: string) {
    super(`ConnectMyPool ${endpoint} returned an invalid response: ${detail}`);
    this.name = 'InvalidApiResponseError';
  }
}

export function parseApiFailure(value: unknown): ApiFailure | undefined {
  if (!isRecord(value) || !isInteger(value.failure_code)) {
    return undefined;
  }
  return {
    failure_code: value.failure_code,
    failure_description:
      typeof value.failure_description === 'string'
        ? value.failure_description
        : 'Unknown API failure',
  };
}

export function parsePoolConfiguration(value: unknown): PoolConfiguration {
  const record = requireRecord(value, 'poolconfig');
  return {
    pool_spa_selection_enabled: requireBoolean(record, 'pool_spa_selection_enabled'),
    heat_cool_selection_enabled: requireBoolean(record, 'heat_cool_selection_enabled'),
    has_heaters: requireBoolean(record, 'has_heaters'),
    has_solar_systems: requireBoolean(record, 'has_solar_systems'),
    has_channels: requireBoolean(record, 'has_channels'),
    has_valves: requireBoolean(record, 'has_valves'),
    has_lighting_zones: requireBoolean(record, 'has_lighting_zones'),
    has_favourites: requireBoolean(record, 'has_favourites'),
    heaters: requireArray(record, 'heaters').map((item) => {
      const heater = requireRecord(item, 'poolconfig.heaters[]');
      return { heater_number: requireInteger(heater, 'heater_number') };
    }),
    solar_systems: requireArray(record, 'solar_systems').map((item) => {
      const solar = requireRecord(item, 'poolconfig.solar_systems[]');
      return { solar_number: requireInteger(solar, 'solar_number') };
    }),
    channels: requireArray(record, 'channels').map((item) => {
      const channel = requireRecord(item, 'poolconfig.channels[]');
      return {
        channel_number: requireInteger(channel, 'channel_number'),
        function: requireInteger(channel, 'function'),
        name: requireString(channel, 'name'),
      };
    }),
    valves: requireArray(record, 'valves').map((item) => {
      const valve = requireRecord(item, 'poolconfig.valves[]');
      return {
        valve_number: requireInteger(valve, 'valve_number'),
        function: requireInteger(valve, 'function'),
        name: requireString(valve, 'name'),
      };
    }),
    lighting_zones: requireArray(record, 'lighting_zones').map((item) => {
      const zone = requireRecord(item, 'poolconfig.lighting_zones[]');
      return {
        lighting_zone_number: requireInteger(zone, 'lighting_zone_number'),
        name: requireString(zone, 'name'),
        color_enabled: requireBoolean(zone, 'color_enabled'),
        colors_available: requireArray(zone, 'colors_available').map((colorItem) => {
          const color = requireRecord(colorItem, 'poolconfig.colors_available[]');
          return {
            color_number: requireInteger(color, 'color_number'),
            color_name: requireString(color, 'color_name'),
          };
        }),
      };
    }),
    favourites: requireArray(record, 'favourites').map((item) => {
      const favourite = requireRecord(item, 'poolconfig.favourites[]');
      return {
        favourite_number: requireInteger(favourite, 'favourite_number'),
        name: requireString(favourite, 'name'),
      };
    }),
  };
}

export function parsePoolStatus(value: unknown): PoolStatus {
  const record = requireRecord(value, 'poolstatus');
  return {
    pool_spa_selection: requireInteger(record, 'pool_spa_selection'),
    heat_cool_selection: requireInteger(record, 'heat_cool_selection'),
    temperature: requireNumber(record, 'temperature'),
    active_favourite: requireInteger(record, 'active_favourite'),
    heaters: requireArray(record, 'heaters').map((item) => {
      const heater = requireRecord(item, 'poolstatus.heaters[]');
      return {
        heater_number: requireInteger(heater, 'heater_number'),
        mode: requireInteger(heater, 'mode'),
        set_temperature: requireNumber(heater, 'set_temperature'),
        spa_set_temperature: requireNumber(heater, 'spa_set_temperature'),
      };
    }),
    solar_systems: requireArray(record, 'solar_systems').map((item) => {
      const solar = requireRecord(item, 'poolstatus.solar_systems[]');
      return {
        solar_number: requireInteger(solar, 'solar_number'),
        mode: requireInteger(solar, 'mode'),
        set_temperature: requireNumber(solar, 'set_temperature'),
      };
    }),
    channels: requireArray(record, 'channels').map((item) => {
      const channel = requireRecord(item, 'poolstatus.channels[]');
      return {
        channel_number: requireInteger(channel, 'channel_number'),
        mode: requireInteger(channel, 'mode'),
      };
    }),
    valves: requireArray(record, 'valves').map((item) => {
      const valve = requireRecord(item, 'poolstatus.valves[]');
      return {
        valve_number: requireInteger(valve, 'valve_number'),
        mode: requireInteger(valve, 'mode'),
      };
    }),
    lighting_zones: requireArray(record, 'lighting_zones').map((item) => {
      const zone = requireRecord(item, 'poolstatus.lighting_zones[]');
      const color = zone.color;
      return {
        lighting_zone_number: requireInteger(zone, 'lighting_zone_number'),
        mode: requireInteger(zone, 'mode'),
        ...(color === undefined ? {} : { color: requireInteger(zone, 'color') }),
      };
    }),
  };
}

export function parsePoolActionResponse(value: unknown): PoolActionResponse {
  const record = requireRecord(value, 'poolaction');
  return {
    action_number: requireInteger(record, 'action_number'),
    execution_status: requireInteger(record, 'execution_status'),
  };
}

export function parsePoolActionStatusResponse(value: unknown): PoolActionStatusResponse {
  const record = requireRecord(value, 'poolactionstatus');
  return {
    execution_status: requireInteger(record, 'execution_status'),
  };
}

function requireRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidApiResponseError(endpoint, 'expected a JSON object');
  }
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new InvalidApiResponseError(key, 'expected an array');
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new InvalidApiResponseError(key, 'expected a boolean');
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new InvalidApiResponseError(key, 'expected a string');
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!isInteger(value)) {
    throw new InvalidApiResponseError(key, 'expected an integer');
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidApiResponseError(key, 'expected a finite number');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
