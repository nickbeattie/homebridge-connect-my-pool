import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  parsePlatformConfig,
} from '../src/config.js';

describe('parsePlatformConfig', () => {
  it('applies safe defaults to a multi-pool configuration', () => {
    const config = parsePlatformConfig({
      platform: 'ConnectMyPool',
      name: 'ConnectMyPool',
      pools: [
        { id: 'backyard', name: 'Backyard', poolApiCode: 'secret-one' },
        {
          id: 'holiday-house',
          name: 'Holiday House',
          poolApiCode: 'secret-two',
          expose: { channels: false },
        },
      ],
    });

    expect(config.pollIntervalSeconds).toBe(60);
    expect(config.pools[0]?.expose).toEqual({
      heaters: true,
      solar: true,
      channels: true,
      valves: true,
      lighting: true,
      favourites: true,
    });
    expect(config.pools[1]?.expose.channels).toBe(false);
    expect(config.pools[1]?.expose.heaters).toBe(true);
  });

  it.each([
    [{ platform: 'ConnectMyPool', name: 'ConnectMyPool', pools: [] }, 'At least one pool'],
    [{
      platform: 'ConnectMyPool',
      name: 'ConnectMyPool',
      pools: [
        { id: 'same', name: 'One', poolApiCode: 'a' },
        { id: 'same', name: 'Two', poolApiCode: 'b' },
      ],
    }, 'configured more than once'],
    [{
      platform: 'ConnectMyPool',
      name: 'ConnectMyPool',
      pools: [{ id: 'Not Valid', name: 'One', poolApiCode: 'a' }],
    }, 'must match'],
    [{
      platform: 'ConnectMyPool',
      name: 'ConnectMyPool',
      pollIntervalSeconds: 59,
      pools: [{ id: 'one', name: 'One', poolApiCode: 'a' }],
    }, '60 to 3600'],
  ])('rejects invalid configuration', (input, message) => {
    expect(() => parsePlatformConfig(input)).toThrowError(
      new RegExp(message),
    );
  });

  it('uses a dedicated configuration error type', () => {
    expect(() => parsePlatformConfig({ platform: 'ConnectMyPool' }))
      .toThrow(ConfigurationError);
  });
});
