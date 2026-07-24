import { describe, expect, it } from 'vitest';

import { ConnectMyPoolClient } from '../src/api/client.js';
import { PoolActionCode } from '../src/api/types.js';

const apiCode = process.env['CONNECT_MY_POOL_API_CODE'];

describe.skipIf(!apiCode)('ConnectMyPool live API', () => {
  it('reads live state and reapplies a lighting zone current mode', async () => {
    const client = new ConnectMyPoolClient(apiCode!);
    const configuration = await client.getConfiguration();
    const before = await client.getStatus();
    const zone = configuration.lighting_zones[0];
    const zoneStatus = before.lighting_zones.find(
      (candidate) => candidate.lighting_zone_number === zone?.lighting_zone_number,
    );

    expect(zone).toBeDefined();
    expect(zoneStatus).toBeDefined();

    await client.executeAction({
      actionCode: PoolActionCode.SetLightingMode,
      deviceNumber: zone!.lighting_zone_number,
      value: String(zoneStatus!.mode),
    });

    const after = await client.getStatus();
    expect(after.lighting_zones.find(
      (candidate) => candidate.lighting_zone_number === zone!.lighting_zone_number,
    )?.mode).toBe(zoneStatus!.mode);
  }, 90_000);
});
