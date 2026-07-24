import { EventEmitter } from 'node:events';

import * as hap from '@homebridge/hap-nodejs';
import type {
  API,
  Logging,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectMyPoolClient } from '../src/api/client.js';
import {
  ActionExecutionStatus,
  HeatCoolSelection,
} from '../src/api/types.js';
import { AccessoryController } from '../src/accessories/controller.js';
import {
  buildAccessoryDescriptors,
  type AccessoryDescriptor,
  type ConnectMyPoolAccessoryContext,
} from '../src/accessories/descriptor.js';
import type { ConfiguredPool } from '../src/config.js';
import { PoolRuntime } from '../src/runtime/pool-runtime.js';
import { ACCESSORY_CONTEXT_VERSION } from '../src/settings.js';
import { fullConfiguration, fullStatus, jsonResponse } from './fixtures.js';

const pool: ConfiguredPool = {
  id: 'backyard',
  name: 'Backyard',
  poolApiCode: 'secret',
  expose: {
    heaters: true,
    solar: true,
    channels: true,
    valves: true,
    lighting: true,
    favourites: true,
  },
};

describe('AccessoryController', () => {
  let runtime: PoolRuntime;
  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  let actionBodies: Array<Record<string, unknown>>;
  const controllers: AccessoryController[] = [];

  beforeEach(async () => {
    actionBodies = [];
    fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const endpoint = String(url);
      if (endpoint.endsWith('/poolconfig')) {
        return jsonResponse(fullConfiguration);
      }
      if (endpoint.endsWith('/poolstatus')) {
        return jsonResponse(fullStatus);
      }
      if (endpoint.endsWith('/poolaction')) {
        actionBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({
          action_number: 1,
          execution_status: ActionExecutionStatus.Succeeded,
        });
      }
      throw new Error(`Unexpected URL ${endpoint}`);
    });
    runtime = new PoolRuntime(pool, 60_000, logger(), {
      client: new ConnectMyPoolClient(pool.poolApiCode, {
        baseUrl: 'https://example.test/api',
        fetch,
      }),
    });
    await runtime.start();
  });

  afterEach(() => {
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
    runtime.stop();
  });

  it('maps the pool system to temperature and spa-mode services', async () => {
    const descriptor = descriptorFor('system');
    const accessory = attach(descriptor);

    const temperature = accessory.getServiceById(
      hap.Service.TemperatureSensor,
      'pool-temperature',
    )!;
    const spaMode = accessory.getServiceById(hap.Service.Switch, 'spa-mode')!;

    await expect(
      temperature
        .getCharacteristic(hap.Characteristic.CurrentTemperature)
        .handleGetRequest(),
    ).resolves.toBe(27);
    await expect(
      spaMode.getCharacteristic(hap.Characteristic.On).handleGetRequest(),
    ).resolves.toBe(false);

    await spaMode.getCharacteristic(hap.Characteristic.On).handleSetRequest(true);
    expect(actionBodies[0]).toMatchObject({
      action_code: 3,
      device_number: 0,
      value: '0',
    });
  });

  it('maps heaters to native HeaterCooler state and temperature control', async () => {
    const descriptor = descriptorFor('heater');
    const accessory = attach(descriptor);
    const service = accessory.getServiceById(hap.Service.HeaterCooler, 'heater-1')!;

    await expect(
      service.getCharacteristic(hap.Characteristic.Active).handleGetRequest(),
    ).resolves.toBe(hap.Characteristic.Active.ACTIVE);
    await expect(
      service
        .getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
        .handleGetRequest(),
    ).resolves.toBe(29);
    await expect(
      service
        .getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
        .handleGetRequest(),
    ).resolves.toBe(29);

    await service
      .getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
      .handleSetRequest(31);
    expect(actionBodies[0]).toMatchObject({
      action_code: 5,
      device_number: 1,
      value: '31',
    });
  });

  it('keeps heat-only systems in heating mode when the unused API field says cooling', async () => {
    runtime.getConfiguration().heat_cool_selection_enabled = false;
    runtime.getStatus().heat_cool_selection = HeatCoolSelection.Cooling;
    const accessory = attach(descriptorFor('heater'));
    const service = accessory.getServiceById(hap.Service.HeaterCooler, 'heater-1')!;

    await expect(
      service
        .getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
        .handleGetRequest(),
    ).resolves.toBe(hap.Characteristic.TargetHeaterCoolerState.HEAT);
    await expect(
      service
        .getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState)
        .handleGetRequest(),
    ).resolves.toBe(hap.Characteristic.CurrentHeaterCoolerState.HEATING);
    expect(
      service.testCharacteristic(hap.Characteristic.CoolingThresholdTemperature),
    ).toBe(false);
  });

  it('creates faithful native services for solar, valves, lighting, and favourites', async () => {
    const solar = attach(descriptorFor('solar'));
    const valve = attach(descriptorFor('valve'));
    const lighting = attach(descriptorFor('lighting'));
    const favourite = attach(descriptorFor('favourite'));

    await expect(
      solar
        .getServiceById(hap.Service.HeaterCooler, 'solar-2')!
        .getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
        .handleGetRequest(),
    ).resolves.toBe(hap.Characteristic.TargetHeaterCoolerState.AUTO);
    await expect(
      valve
        .getServiceById(hap.Service.Valve, 'valve-4')!
        .getCharacteristic(hap.Characteristic.InUse)
        .handleGetRequest(),
    ).resolves.toBe(hap.Characteristic.InUse.NOT_IN_USE);
    await expect(
      lighting
        .getServiceById(hap.Service.Lightbulb, 'lighting-5')!
        .getCharacteristic(hap.Characteristic.On)
        .handleGetRequest(),
    ).resolves.toBe(true);
    await expect(
      favourite
        .getServiceById(hap.Service.Switch, 'favourite-6')!
        .getCharacteristic(hap.Characteristic.On)
        .handleGetRequest(),
    ).resolves.toBe(true);
  });

  it('implements channels as one-shot cycle switches that reset off', async () => {
    const accessory = attach(descriptorFor('channel'));
    const service = accessory.getServiceById(hap.Service.Switch, 'channel-3')!;
    const characteristic = service.getCharacteristic(hap.Characteristic.On);

    await characteristic.handleSetRequest(true);
    expect(actionBodies[0]).toMatchObject({
      action_code: 1,
      device_number: 3,
      value: '',
    });
    await vi.waitFor(() => expect(characteristic.value).toBe(false));
  });

  it('rejects a favourite reset safely when no status has loaded', async () => {
    const descriptor = descriptorFor('favourite');
    const accessory = new FakePlatformAccessory(
      descriptor.displayName,
      hap.uuid.generate('favourite-without-status'),
    );
    const unavailableRuntime = {
      execute: vi.fn(async () => undefined),
      getConfiguration: () => fullConfiguration,
      getStatus: () => {
        throw new Error('No status is available.');
      },
      hasFault: () => true,
      onState: () => () => undefined,
    };
    const controller = new AccessoryController(
      { hap } as unknown as API,
      logger(),
      accessory as unknown as PlatformAccessory<ConnectMyPoolAccessoryContext>,
      descriptor,
      unavailableRuntime as unknown as PoolRuntime,
    );
    controllers.push(controller);

    const characteristic = accessory
      .getServiceById(hap.Service.Switch, 'favourite-6')!
      .getCharacteristic(hap.Characteristic.On);

    await expect(characteristic.handleSetRequest(false)).rejects.toBeDefined();
  });

  it('publishes API faults on services that support StatusFault', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      failure_code: 7,
      failure_description: 'Pool Not Connected',
    }));
    await expect(runtime.refreshStatus(true)).rejects.toThrow('Pool Not Connected');
    const accessory = attach(descriptorFor('system'));
    const service = accessory.getServiceById(
      hap.Service.TemperatureSensor,
      'pool-temperature',
    )!;

    expect(
      service.getCharacteristic(hap.Characteristic.StatusFault).value,
    ).toBe(hap.Characteristic.StatusFault.GENERAL_FAULT);

    await runtime.refreshStatus(true);

    expect(
      service.getCharacteristic(hap.Characteristic.StatusFault).value,
    ).toBe(hap.Characteristic.StatusFault.NO_FAULT);
  });

  it('removes services that no longer belong to a cached accessory', () => {
    const descriptor = descriptorFor('system');
    const accessory = new FakePlatformAccessory(
      descriptor.displayName,
      hap.uuid.generate('cached-system'),
    );
    accessory.addService(
      hap.Service.TemperatureSensor,
      'Old Temperature Name',
      'pool-temperature',
    );
    accessory.addService(hap.Service.Switch, 'Old Control', 'old-control');

    controllers.push(new AccessoryController(
      { hap } as unknown as API,
      logger(),
      accessory as unknown as PlatformAccessory<ConnectMyPoolAccessoryContext>,
      descriptor,
      runtime,
    ));

    expect(accessory.getServiceById(hap.Service.Switch, 'old-control')).toBeUndefined();
    expect(
      accessory
        .getServiceById(hap.Service.TemperatureSensor, 'pool-temperature')!
        .getCharacteristic(hap.Characteristic.Name)
        .value,
    ).toBe('Backyard Temperature');
  });

  function descriptorFor(kind: AccessoryDescriptor['kind']): AccessoryDescriptor {
    return buildAccessoryDescriptors(pool, fullConfiguration)
      .find((descriptor) => descriptor.kind === kind)!;
  }

  function attach(
    descriptor: AccessoryDescriptor,
  ): FakePlatformAccessory {
    const accessory = new FakePlatformAccessory(
      descriptor.displayName,
      hap.uuid.generate(`${descriptor.kind}-${descriptor.deviceNumber}`),
    );
    accessory.context = {
      schemaVersion: ACCESSORY_CONTEXT_VERSION,
      descriptor,
    };
    controllers.push(new AccessoryController(
      { hap } as unknown as API,
      logger(),
      accessory as unknown as PlatformAccessory<ConnectMyPoolAccessoryContext>,
      descriptor,
      runtime,
    ));
    return accessory;
  }
});

class FakePlatformAccessory extends EventEmitter {
  readonly inner: hap.Accessory;
  readonly UUID: string;
  readonly services: Service[];
  displayName: string;
  category = hap.Categories.OTHER;
  context: ConnectMyPoolAccessoryContext = {
    schemaVersion: ACCESSORY_CONTEXT_VERSION,
    descriptor: {
      poolId: 'unconfigured',
      kind: 'system',
      deviceNumber: 0,
      displayName: 'Unconfigured',
      model: 'Unconfigured',
      vendorName: 'Unconfigured',
    },
  };

  constructor(displayName: string, uuid: string) {
    super();
    this.displayName = displayName;
    this.UUID = uuid;
    this.inner = new hap.Accessory(displayName, uuid);
    this.services = this.inner.services;
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
