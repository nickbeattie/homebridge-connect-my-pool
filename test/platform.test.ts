import { EventEmitter } from 'node:events';

import * as hap from '@homebridge/hap-nodejs';
import type {
  API,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AccessoryDescriptor,
  ConnectMyPoolAccessoryContext,
} from '../src/accessories/descriptor.js';
import { ConnectMyPoolPlatform } from '../src/platform.js';
import { ACCESSORY_CONTEXT_VERSION } from '../src/settings.js';
import { fullConfiguration, fullStatus, jsonResponse } from './fixtures.js';

const validConfig: PlatformConfig = {
  platform: 'ConnectMyPool',
  name: 'ConnectMyPool',
  pollIntervalSeconds: 60,
  pools: [{
    id: 'backyard',
    name: 'Backyard',
    poolApiCode: 'secret',
  }],
};

describe('ConnectMyPoolPlatform', () => {
  const apis: FakeApi[] = [];

  afterEach(() => {
    for (const api of apis.splice(0)) {
      api.emit('shutdown');
    }
    vi.unstubAllGlobals();
  });

  it('discovers and registers stable accessories after Homebridge launches', async () => {
    const fetch = liveFixtureFetch();
    vi.stubGlobal('fetch', fetch);
    const api = createApi();

    new ConnectMyPoolPlatform(
      logger(),
      validConfig,
      api as unknown as API,
    );
    api.emit('didFinishLaunching');

    await vi.waitFor(() => {
      expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(7);
    });
    const registered = api.registerPlatformAccessories.mock.calls.flatMap(
      (call) => call[2] as FakePlatformAccessory[],
    );

    expect(registered.map((accessory) => accessory.context.descriptor.kind)).toEqual([
      'system',
      'heater',
      'solar',
      'channel',
      'valve',
      'lighting',
      'favourite',
    ]);
    expect(registered[0]?.UUID).toBe(
      hap.uuid.generate('connect-my-pool:backyard:system:0'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('restores a cached accessory without registering a duplicate', async () => {
    vi.stubGlobal('fetch', liveFixtureFetch());
    const api = createApi();
    const system = accessoryFor({
      poolId: 'backyard',
      kind: 'system',
      deviceNumber: 0,
      displayName: 'Old Name',
      model: 'ConnectMyPool System',
      vendorName: 'Old Name',
    });
    const platform = new ConnectMyPoolPlatform(
      logger(),
      validConfig,
      api as unknown as API,
    );

    platform.configureAccessory(
      system as unknown as PlatformAccessory<ConnectMyPoolAccessoryContext>,
    );
    api.emit('didFinishLaunching');

    await vi.waitFor(() => {
      expect(api.updatePlatformAccessories).toHaveBeenCalled();
    });
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(6);
    expect(system.displayName).toBe('Backyard');
  });

  it('unregisters cached accessories for pools removed from configuration', async () => {
    vi.stubGlobal('fetch', liveFixtureFetch());
    const api = createApi();
    const removed = accessoryFor({
      poolId: 'old-pool',
      kind: 'system',
      deviceNumber: 0,
      displayName: 'Old Pool',
      model: 'ConnectMyPool System',
      vendorName: 'Old Pool',
    });
    const platform = new ConnectMyPoolPlatform(
      logger(),
      validConfig,
      api as unknown as API,
    );

    platform.configureAccessory(
      removed as unknown as PlatformAccessory<ConnectMyPoolAccessoryContext>,
    );
    api.emit('didFinishLaunching');

    await vi.waitFor(() => {
      expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
        '@nickbeattie/homebridge-connect-my-pool',
        'ConnectMyPool',
        [removed],
      );
    });
  });

  it('does not contact the API or mutate accessories when configuration is invalid', () => {
    const fetch = liveFixtureFetch();
    vi.stubGlobal('fetch', fetch);
    const api = createApi();

    new ConnectMyPoolPlatform(
      logger(),
      { platform: 'ConnectMyPool', name: 'ConnectMyPool', pools: [] },
      api as unknown as API,
    );
    api.emit('didFinishLaunching');

    expect(fetch).not.toHaveBeenCalled();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.updatePlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  });

  function createApi(): FakeApi {
    const api = new FakeApi();
    apis.push(api);
    return api;
  }
});

class FakeApi extends EventEmitter {
  readonly hap = hap;
  readonly platformAccessory = FakePlatformAccessory;
  readonly registerPlatformAccessories = vi.fn();
  readonly updatePlatformAccessories = vi.fn();
  readonly unregisterPlatformAccessories = vi.fn();
}

class FakePlatformAccessory extends EventEmitter {
  readonly inner: hap.Accessory;
  readonly UUID: string;
  readonly services: Service[];
  displayName: string;
  category: number;
  context: ConnectMyPoolAccessoryContext;

  constructor(
    displayName: string,
    uuid: string,
    category = hap.Categories.OTHER,
  ) {
    super();
    this.displayName = displayName;
    this.UUID = uuid;
    this.category = category;
    this.inner = new hap.Accessory(displayName, uuid);
    this.services = this.inner.services;
    this.context = {
      schemaVersion: ACCESSORY_CONTEXT_VERSION,
      descriptor: {
        poolId: 'unconfigured',
        kind: 'system',
        deviceNumber: 0,
        displayName,
        model: 'Unconfigured',
        vendorName: displayName,
      },
    };
  }

  updateDisplayName(name: string): void {
    this.displayName = name;
    this.inner.displayName = name;
  }

  addService<T extends typeof hap.Service>(
    service: T,
    ...args: ConstructorParameters<T>
  ): Service {
    return this.inner.addService(service, ...args);
  }

  getService<T extends hap.WithUUID<typeof hap.Service>>(
    service: string | T,
  ): Service | undefined {
    return this.inner.getService(service);
  }

  getServiceById<T extends hap.WithUUID<typeof hap.Service>>(
    service: string | T,
    subtype: string,
  ): Service | undefined {
    return this.inner.getServiceById(service, subtype);
  }

  removeService(service: Service): void {
    this.inner.removeService(service);
  }
}

function accessoryFor(descriptor: AccessoryDescriptor): FakePlatformAccessory {
  const accessory = new FakePlatformAccessory(
    descriptor.displayName,
    hap.uuid.generate(
      `connect-my-pool:${descriptor.poolId}:${descriptor.kind}:${descriptor.deviceNumber}`,
    ),
  );
  accessory.context = {
    schemaVersion: ACCESSORY_CONTEXT_VERSION,
    descriptor,
  };
  return accessory;
}

function liveFixtureFetch(): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async (url) => {
    if (String(url).endsWith('/poolconfig')) {
      return jsonResponse(fullConfiguration);
    }
    if (String(url).endsWith('/poolstatus')) {
      return jsonResponse(fullStatus);
    }
    throw new Error(`Unexpected URL ${String(url)}`);
  });
}

function logger(): Logging {
  const result = vi.fn() as unknown as Logging;
  result.info = vi.fn();
  result.warn = vi.fn();
  result.error = vi.fn();
  result.debug = vi.fn();
  result.log = vi.fn();
  result.success = vi.fn();
  result.prefix = 'test';
  return result;
}
