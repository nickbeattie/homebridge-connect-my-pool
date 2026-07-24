import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { AccessoryController } from './accessories/controller.js';
import {
  type AccessoryDescriptor,
  type ConnectMyPoolAccessoryContext,
  accessoryIdentity,
  buildAccessoryDescriptors,
  isAccessoryContext,
} from './accessories/descriptor.js';
import {
  ConfigurationError,
  parsePlatformConfig,
  type ConnectMyPoolPlatformConfig,
  type ConfiguredPool,
} from './config.js';
import { PoolRuntime } from './runtime/pool-runtime.js';
import {
  ACCESSORY_CONTEXT_VERSION,
  PLATFORM_NAME,
  PLUGIN_NAME,
} from './settings.js';

export class ConnectMyPoolPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly controllers = new Map<string, AccessoryController>();
  private readonly runtimes = new Map<string, PoolRuntime>();
  private readonly parsedConfig: ConnectMyPoolPlatformConfig | undefined;
  private launching = false;

  constructor(
    private readonly log: Logging,
    config: PlatformConfig,
    private readonly api: API,
  ) {
    try {
      this.parsedConfig = parsePlatformConfig(config);
    } catch (error: unknown) {
      const message = error instanceof ConfigurationError
        ? error.message
        : `Unexpected configuration error: ${String(error)}`;
      this.log.error(`ConnectMyPool is not starting: ${message}`);
    }

    this.api.on('didFinishLaunching', () => {
      void this.launch();
    });
    this.api.on('shutdown', () => this.shutdown());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
    this.log.info(`Restored cached accessory: ${accessory.displayName}`);
  }

  private async launch(): Promise<void> {
    if (this.launching || !this.parsedConfig) {
      return;
    }
    this.launching = true;

    this.removeAccessoriesForUnconfiguredPools();

    const starts = this.parsedConfig.pools.map(async (pool) => {
      const runtime = new PoolRuntime(
        pool,
        this.parsedConfig!.pollIntervalSeconds * 1000,
        this.log,
      );
      this.runtimes.set(pool.id, runtime);
      runtime.onConfiguration((configuration) => {
        this.reconcilePool(pool, runtime, buildAccessoryDescriptors(pool, configuration));
      });

      try {
        await runtime.start();
        this.log.info(`[${pool.name}] ConnectMyPool is ready.`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error(`[${pool.name}] Initialisation failed: ${message}`);
      }
    });

    await Promise.all(starts);
  }

  private reconcilePool(
    pool: ConfiguredPool,
    runtime: PoolRuntime,
    descriptors: AccessoryDescriptor[],
  ): void {
    const desiredUuids = new Set<string>();
    const updated: PlatformAccessory[] = [];

    for (const descriptor of descriptors) {
      const uuid = this.api.hap.uuid.generate(accessoryIdentity(descriptor));
      desiredUuids.add(uuid);

      let accessory = this.cachedAccessories.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(
          descriptor.displayName,
          uuid,
          this.categoryFor(descriptor),
        );
        this.setContext(accessory, descriptor);
        this.cachedAccessories.set(uuid, accessory);
        this.bindController(accessory, descriptor, runtime);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info(`[${pool.name}] Added accessory: ${descriptor.displayName}`);
        continue;
      }

      this.setContext(accessory, descriptor);
      this.bindController(accessory, descriptor, runtime);
      updated.push(accessory);
    }

    if (updated.length > 0) {
      this.api.updatePlatformAccessories(updated);
    }

    const stale = [...this.cachedAccessories.values()].filter((accessory) => {
      const context: unknown = accessory.context;
      if (!isAccessoryContext(context)) {
        return false;
      }
      return context.descriptor.poolId === pool.id && !desiredUuids.has(accessory.UUID);
    });

    this.unregister(stale, pool.name);
  }

  private bindController(
    accessory: PlatformAccessory,
    descriptor: AccessoryDescriptor,
    runtime: PoolRuntime,
  ): void {
    this.controllers.get(accessory.UUID)?.dispose();
    const controller = new AccessoryController(
      this.api,
      this.log,
      accessory as PlatformAccessory<ConnectMyPoolAccessoryContext>,
      descriptor,
      runtime,
    );
    this.controllers.set(accessory.UUID, controller);
  }

  private setContext(accessory: PlatformAccessory, descriptor: AccessoryDescriptor): void {
    const context = accessory.context as Record<string, unknown>;
    context.schemaVersion = ACCESSORY_CONTEXT_VERSION;
    context.descriptor = descriptor;
  }

  private removeAccessoriesForUnconfiguredPools(): void {
    const configuredPoolIds = new Set(
      this.parsedConfig?.pools.map((pool) => pool.id) ?? [],
    );
    const stale = [...this.cachedAccessories.values()].filter((accessory) => {
      const context: unknown = accessory.context;
      return isAccessoryContext(context)
        && !configuredPoolIds.has(context.descriptor.poolId);
    });
    this.unregister(stale, 'configuration');
  }

  private unregister(accessories: PlatformAccessory[], reason: string): void {
    if (accessories.length === 0) {
      return;
    }

    for (const accessory of accessories) {
      this.controllers.get(accessory.UUID)?.dispose();
      this.controllers.delete(accessory.UUID);
      this.cachedAccessories.delete(accessory.UUID);
      this.log.info(`[${reason}] Removed accessory: ${accessory.displayName}`);
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessories);
  }

  private categoryFor(descriptor: AccessoryDescriptor): number {
    switch (descriptor.kind) {
      case 'system':
        return this.api.hap.Categories.SENSOR;
      case 'heater':
      case 'solar':
        return this.api.hap.Categories.THERMOSTAT;
      case 'lighting':
        return this.api.hap.Categories.LIGHTBULB;
      case 'valve':
        return this.api.hap.Categories.FAUCET;
      case 'channel':
      case 'favourite':
        return this.api.hap.Categories.SWITCH;
    }
  }

  private shutdown(): void {
    for (const controller of this.controllers.values()) {
      controller.dispose();
    }
    this.controllers.clear();
    for (const runtime of this.runtimes.values()) {
      runtime.stop();
    }
    this.runtimes.clear();
  }
}
