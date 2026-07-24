import type { PlatformConfig } from 'homebridge';

import { DEFAULT_POLL_INTERVAL_SECONDS, PLATFORM_NAME } from './settings.js';

const POOL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface ExposureConfig {
  heaters: boolean;
  solar: boolean;
  channels: boolean;
  valves: boolean;
  lighting: boolean;
  favourites: boolean;
}

export interface ConfiguredPool {
  id: string;
  name: string;
  poolApiCode: string;
  expose: ExposureConfig;
}

export interface ConnectMyPoolPlatformConfig extends PlatformConfig {
  platform: typeof PLATFORM_NAME;
  name: string;
  pools: ConfiguredPool[];
  pollIntervalSeconds: number;
}

const DEFAULT_EXPOSURE: ExposureConfig = {
  heaters: true,
  solar: true,
  channels: true,
  valves: true,
  lighting: true,
  favourites: true,
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function parsePlatformConfig(config: PlatformConfig): ConnectMyPoolPlatformConfig {
  const name = readRequiredString(config, 'name');
  const pollIntervalSeconds = readPollInterval(config['pollIntervalSeconds'] as unknown);
  const rawPools: unknown = config['pools'];

  if (!Array.isArray(rawPools) || rawPools.length === 0) {
    throw new ConfigurationError('At least one pool must be configured.');
  }

  const pools = rawPools.map((rawPool, index) => parsePool(rawPool, index));
  const poolIds = new Set<string>();

  for (const pool of pools) {
    if (poolIds.has(pool.id)) {
      throw new ConfigurationError(`Pool id "${pool.id}" is configured more than once.`);
    }
    poolIds.add(pool.id);
  }

  return {
    ...config,
    platform: PLATFORM_NAME,
    name,
    pools,
    pollIntervalSeconds,
  };
}

function parsePool(value: unknown, index: number): ConfiguredPool {
  if (!isRecord(value)) {
    throw new ConfigurationError(`Pool at index ${index} must be an object.`);
  }

  const id = readRequiredString(value, 'id');
  if (!POOL_ID_PATTERN.test(id)) {
    throw new ConfigurationError(
      `Pool id "${id}" must match ${POOL_ID_PATTERN.source}.`,
    );
  }

  return {
    id,
    name: readRequiredString(value, 'name'),
    poolApiCode: readRequiredString(value, 'poolApiCode'),
    expose: parseExposure(value.expose),
  };
}

function parseExposure(value: unknown): ExposureConfig {
  if (value === undefined) {
    return { ...DEFAULT_EXPOSURE };
  }
  if (!isRecord(value)) {
    throw new ConfigurationError('Pool expose configuration must be an object.');
  }

  return {
    heaters: readOptionalBoolean(value, 'heaters', DEFAULT_EXPOSURE.heaters),
    solar: readOptionalBoolean(value, 'solar', DEFAULT_EXPOSURE.solar),
    channels: readOptionalBoolean(value, 'channels', DEFAULT_EXPOSURE.channels),
    valves: readOptionalBoolean(value, 'valves', DEFAULT_EXPOSURE.valves),
    lighting: readOptionalBoolean(value, 'lighting', DEFAULT_EXPOSURE.lighting),
    favourites: readOptionalBoolean(value, 'favourites', DEFAULT_EXPOSURE.favourites),
  };
}

function readPollInterval(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 60 || value > 3600) {
    throw new ConfigurationError('pollIntervalSeconds must be an integer from 60 to 3600.');
  }
  return value;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigurationError(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new ConfigurationError(`${key} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
