import { describe, expect, it } from 'vitest';

import type { ConfiguredPool } from '../src/config.js';
import {
  accessoryIdentity,
  buildAccessoryDescriptors,
} from '../src/accessories/descriptor.js';
import { fullConfiguration } from './fixtures.js';

const pool: ConfiguredPool = {
  id: 'backyard',
  name: 'Backyard',
  poolApiCode: 'not-used',
  expose: {
    heaters: true,
    solar: true,
    channels: true,
    valves: true,
    lighting: true,
    favourites: true,
  },
};

describe('accessory descriptors', () => {
  it('discovers every supported capability with stable pool-scoped identities', () => {
    const descriptors = buildAccessoryDescriptors(pool, fullConfiguration);

    expect(descriptors.map((descriptor) => descriptor.kind)).toEqual([
      'system',
      'heater',
      'solar',
      'channel',
      'valve',
      'lighting',
      'favourite',
    ]);
    expect(accessoryIdentity(descriptors[1]!)).toBe(
      'connect-my-pool:backyard:heater:1',
    );
    expect(descriptors.find(({ kind }) => kind === 'channel')?.displayName)
      .toBe('Backyard Next Filter Pump Mode');
  });

  it('keeps identical vendor numbers distinct across pools', () => {
    const first = buildAccessoryDescriptors(pool, fullConfiguration)[1]!;
    const second = buildAccessoryDescriptors(
      { ...pool, id: 'holiday-house' },
      fullConfiguration,
    )[1]!;

    expect(accessoryIdentity(first)).not.toBe(accessoryIdentity(second));
  });

  it('honours per-pool exposure controls without hiding the system sensor', () => {
    const descriptors = buildAccessoryDescriptors(
      {
        ...pool,
        expose: {
          heaters: false,
          solar: false,
          channels: false,
          valves: false,
          lighting: false,
          favourites: false,
        },
      },
      fullConfiguration,
    );

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.kind).toBe('system');
  });
});
