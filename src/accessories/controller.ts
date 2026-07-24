import type {
  API,
  CharacteristicValue,
  Logging,
  PlatformAccessory,
  Service,
  WithUUID,
} from 'homebridge';

import {
  HeatCoolSelection,
  HeaterMode,
  PoolActionCode,
  PoolSpaSelection,
  ThreeStateMode,
  type PoolStatus,
} from '../api/types.js';
import type { PoolRuntime } from '../runtime/pool-runtime.js';
import { MANUFACTURER } from '../settings.js';
import type {
  AccessoryDescriptor,
  ConnectMyPoolAccessoryContext,
} from './descriptor.js';

export class AccessoryController {
  private readonly Service: API['hap']['Service'];
  private readonly Characteristic: API['hap']['Characteristic'];
  private readonly services: Service[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    api: API,
    private readonly log: Logging,
    private readonly accessory: PlatformAccessory<ConnectMyPoolAccessoryContext>,
    private readonly descriptor: AccessoryDescriptor,
    private readonly runtime: PoolRuntime,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.configureInformation();
    this.configureServices();
    this.removeStaleServices();
    this.unsubscribe = runtime.onState(() => this.refresh());
    this.refresh();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private configureInformation(): void {
    this.accessory.updateDisplayName(this.descriptor.displayName);
    const information = this.accessory.getService(this.Service.AccessoryInformation);
    information
      ?.setCharacteristic(this.Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(this.Characteristic.Model, this.descriptor.model)
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        `${this.descriptor.poolId}-${this.descriptor.kind}-${this.descriptor.deviceNumber}`,
      );
  }

  private configureServices(): void {
    switch (this.descriptor.kind) {
      case 'system':
        this.configureSystem();
        break;
      case 'heater':
        this.configureHeater();
        break;
      case 'solar':
        this.configureSolar();
        break;
      case 'channel':
        this.configureChannel();
        break;
      case 'valve':
        this.configureValve();
        break;
      case 'lighting':
        this.configureLighting();
        break;
      case 'favourite':
        this.configureFavourite();
        break;
    }
  }

  private configureSystem(): void {
    const temperature = this.service(
      this.Service.TemperatureSensor,
      'pool-temperature',
      `${this.descriptor.displayName} Temperature`,
    );
    temperature.getCharacteristic(this.Characteristic.StatusFault);
    temperature
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(() => this.status().temperature);

    if (this.runtime.getConfiguration().pool_spa_selection_enabled) {
      const spaMode = this.service(
        this.Service.Switch,
        'spa-mode',
        `${this.descriptor.displayName} Spa Mode`,
      );
      spaMode
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => this.status().pool_spa_selection === PoolSpaSelection.Spa)
        .onSet(async (value) => {
          await this.runtime.execute({
            actionCode: PoolActionCode.SetPoolSpaSelection,
            deviceNumber: 0,
            value: asBoolean(value)
              ? String(PoolSpaSelection.Spa)
              : String(PoolSpaSelection.Pool),
          });
        });
    }
  }

  private configureHeater(): void {
    const service = this.service(
      this.Service.HeaterCooler,
      `heater-${this.descriptor.deviceNumber}`,
      this.descriptor.displayName,
    );
    const supportsCooling = this.runtime.getConfiguration().heat_cool_selection_enabled;

    service
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => (
        this.heater().mode === HeaterMode.Off
          ? this.Characteristic.Active.INACTIVE
          : this.Characteristic.Active.ACTIVE
      ))
      .onSet(async (value) => {
        await this.runtime.execute({
          actionCode: PoolActionCode.SetHeaterMode,
          deviceNumber: this.descriptor.deviceNumber,
          value: String(
            asNumber(value) === this.Characteristic.Active.ACTIVE
              ? HeaterMode.On
              : HeaterMode.Off,
          ),
        });
      });

    service
      .getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
      .onGet(() => this.currentHeaterState());

    const targetState = service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: supportsCooling
          ? [
              this.Characteristic.TargetHeaterCoolerState.HEAT,
              this.Characteristic.TargetHeaterCoolerState.COOL,
            ]
          : [this.Characteristic.TargetHeaterCoolerState.HEAT],
      })
      .onGet(() => this.targetHeaterState());

    targetState.onSet(async (value) => {
      if (!supportsCooling) {
        return;
      }
      const requested = asNumber(value);
      await this.runtime.execute({
        actionCode: PoolActionCode.SetHeatCoolSelection,
        deviceNumber: 0,
        value: String(
          requested === this.Characteristic.TargetHeaterCoolerState.COOL
            ? HeatCoolSelection.Cooling
            : HeatCoolSelection.Heating,
        ),
      });
    });

    service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(() => this.status().temperature);

    service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 10, maxValue: 40, minStep: 1 })
      .onGet(() => this.heaterTargetTemperature())
      .onSet((value) => this.setHeaterTemperature(value));

    if (supportsCooling) {
      service
        .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
        .setProps({ minValue: 10, maxValue: 40, minStep: 1 })
        .onGet(() => this.heaterTargetTemperature())
        .onSet((value) => this.setHeaterTemperature(value));
    } else if (
      service.testCharacteristic(this.Characteristic.CoolingThresholdTemperature)
    ) {
      service.removeCharacteristic(
        service.getCharacteristic(this.Characteristic.CoolingThresholdTemperature),
      );
    }
  }

  private configureSolar(): void {
    const service = this.service(
      this.Service.HeaterCooler,
      `solar-${this.descriptor.deviceNumber}`,
      this.descriptor.displayName,
    );

    service
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => (
        this.solar().mode === ThreeStateMode.Off
          ? this.Characteristic.Active.INACTIVE
          : this.Characteristic.Active.ACTIVE
      ))
      .onSet(async (value) => {
        await this.runtime.execute({
          actionCode: PoolActionCode.SetSolarMode,
          deviceNumber: this.descriptor.deviceNumber,
          value: String(
            asNumber(value) === this.Characteristic.Active.ACTIVE
              ? ThreeStateMode.Auto
              : ThreeStateMode.Off,
          ),
        });
      });

    service
      .getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
      .onGet(() => {
        const mode = this.solar().mode;
        if (mode === ThreeStateMode.Off) {
          return this.Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }
        return mode === ThreeStateMode.On
          ? this.Characteristic.CurrentHeaterCoolerState.HEATING
          : this.Characteristic.CurrentHeaterCoolerState.IDLE;
      });

    service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [
          this.Characteristic.TargetHeaterCoolerState.AUTO,
          this.Characteristic.TargetHeaterCoolerState.HEAT,
        ],
      })
      .onGet(() => (
        this.solar().mode === ThreeStateMode.On
          ? this.Characteristic.TargetHeaterCoolerState.HEAT
          : this.Characteristic.TargetHeaterCoolerState.AUTO
      ))
      .onSet(async (value) => {
        await this.runtime.execute({
          actionCode: PoolActionCode.SetSolarMode,
          deviceNumber: this.descriptor.deviceNumber,
          value: String(
            asNumber(value) === this.Characteristic.TargetHeaterCoolerState.HEAT
              ? ThreeStateMode.On
              : ThreeStateMode.Auto,
          ),
        });
      });

    service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(() => this.status().temperature);

    service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 10, maxValue: 40, minStep: 1 })
      .onGet(() => this.solar().set_temperature)
      .onSet(async (value) => {
        await this.runtime.execute({
          actionCode: PoolActionCode.SetSolarTemperature,
          deviceNumber: this.descriptor.deviceNumber,
          value: String(validateTemperature(value)),
        });
      });
  }

  private configureChannel(): void {
    const service = this.service(
      this.Service.Switch,
      `channel-${this.descriptor.deviceNumber}`,
      this.descriptor.displayName,
    );
    service
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (!asBoolean(value)) {
          return;
        }
        try {
          await this.runtime.execute({
            actionCode: PoolActionCode.CycleChannelMode,
            deviceNumber: this.descriptor.deviceNumber,
            value: '',
          });
        } finally {
          const reset = setTimeout(
            () => service.updateCharacteristic(this.Characteristic.On, false),
            0,
          );
          reset.unref();
        }
      });
  }

  private configureValve(): void {
    const service = this.service(
      this.Service.Valve,
      `valve-${this.descriptor.deviceNumber}`,
      this.descriptor.displayName,
    );
    service.setCharacteristic(
      this.Characteristic.ValveType,
      this.Characteristic.ValveType.GENERIC_VALVE,
    );
    service.getCharacteristic(this.Characteristic.StatusFault);
    service
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => (
        this.valve().mode === ThreeStateMode.Off
          ? this.Characteristic.Active.INACTIVE
          : this.Characteristic.Active.ACTIVE
      ))
      .onSet(async (value) => {
        await this.runtime.execute({
          actionCode: PoolActionCode.SetValveMode,
          deviceNumber: this.descriptor.deviceNumber,
          value: String(
            asNumber(value) === this.Characteristic.Active.ACTIVE
              ? ThreeStateMode.On
              : ThreeStateMode.Off,
          ),
        });
      });
    service
      .getCharacteristic(this.Characteristic.InUse)
      .onGet(() => (
        this.valve().mode === ThreeStateMode.On
          ? this.Characteristic.InUse.IN_USE
          : this.Characteristic.InUse.NOT_IN_USE
      ));
  }

  private configureLighting(): void {
    const service = this.service(
      this.Service.Lightbulb,
      `lighting-${this.descriptor.deviceNumber}`,
      this.descriptor.displayName,
    );
    service
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.lighting().mode !== ThreeStateMode.Off)
      .onSet(async (value) => {
        await this.runtime.execute({
          actionCode: PoolActionCode.SetLightingMode,
          deviceNumber: this.descriptor.deviceNumber,
          value: String(asBoolean(value) ? ThreeStateMode.On : ThreeStateMode.Off),
        });
      });
  }

  private configureFavourite(): void {
    const service = this.service(
      this.Service.Switch,
      `favourite-${this.descriptor.deviceNumber}`,
      this.descriptor.displayName,
    );
    const characteristic = service.getCharacteristic(this.Characteristic.On);
    characteristic
      .onGet(() => this.isFavouriteActive())
      .onSet(async (value) => {
        if (!asBoolean(value)) {
          const active = this.isFavouriteActive();
          queueMicrotask(() => characteristic.updateValue(active));
          return;
        }
        await this.runtime.execute({
          actionCode: PoolActionCode.SetActiveFavourite,
          deviceNumber: this.descriptor.deviceNumber,
          value: '',
        });
      });
  }

  private service(
    constructor: WithUUID<typeof Service>,
    subtype: string,
    displayName: string,
  ): Service {
    const service = this.accessory.getServiceById(constructor, subtype)
      ?? this.accessory.addService(constructor, displayName, subtype);
    service.setCharacteristic(this.Characteristic.Name, displayName);
    this.services.push(service);
    return service;
  }

  private removeStaleServices(): void {
    const information = this.accessory.getService(this.Service.AccessoryInformation);
    for (const service of [...this.accessory.services]) {
      if (service !== information && !this.services.includes(service)) {
        this.accessory.removeService(service);
      }
    }
  }

  private refresh(): void {
    const fault = this.runtime.hasFault()
      ? this.Characteristic.StatusFault.GENERAL_FAULT
      : this.Characteristic.StatusFault.NO_FAULT;

    for (const service of this.services) {
      if (service.testCharacteristic(this.Characteristic.StatusFault)) {
        service.updateCharacteristic(this.Characteristic.StatusFault, fault);
      }
    }

    let status: PoolStatus;
    try {
      status = this.runtime.getStatus();
    } catch {
      return;
    }

    try {
      switch (this.descriptor.kind) {
        case 'system':
          this.refreshSystem(status);
          break;
        case 'heater':
          this.refreshHeater(status);
          break;
        case 'solar':
          this.refreshSolar(status);
          break;
        case 'channel':
          break;
        case 'valve':
          this.refreshValve(status);
          break;
        case 'lighting':
          this.refreshLighting(status);
          break;
        case 'favourite':
          this.refreshFavourite(status);
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`[${this.descriptor.displayName}] State update failed: ${message}`);
    }
  }

  private refreshSystem(status: PoolStatus): void {
    const temperature = this.services[0];
    temperature?.updateCharacteristic(
      this.Characteristic.CurrentTemperature,
      status.temperature,
    );
    const spaMode = this.services[1];
    spaMode?.updateCharacteristic(
      this.Characteristic.On,
      status.pool_spa_selection === PoolSpaSelection.Spa,
    );
  }

  private refreshHeater(status: PoolStatus): void {
    const service = this.services[0];
    const heater = this.findHeater(status);
    service
      ?.updateCharacteristic(
        this.Characteristic.Active,
        heater.mode === HeaterMode.Off
          ? this.Characteristic.Active.INACTIVE
          : this.Characteristic.Active.ACTIVE,
      )
      .updateCharacteristic(
        this.Characteristic.CurrentHeaterCoolerState,
        this.currentHeaterState(),
      )
      .updateCharacteristic(
        this.Characteristic.TargetHeaterCoolerState,
        this.targetHeaterState(),
      )
      .updateCharacteristic(this.Characteristic.CurrentTemperature, status.temperature)
      .updateCharacteristic(
        this.Characteristic.HeatingThresholdTemperature,
        this.heaterTargetTemperature(),
      );

    if (service?.testCharacteristic(this.Characteristic.CoolingThresholdTemperature)) {
      service.updateCharacteristic(
        this.Characteristic.CoolingThresholdTemperature,
        this.heaterTargetTemperature(),
      );
    }
  }

  private refreshSolar(status: PoolStatus): void {
    const service = this.services[0];
    const solar = this.findSolar(status);
    const active = solar.mode === ThreeStateMode.Off
      ? this.Characteristic.Active.INACTIVE
      : this.Characteristic.Active.ACTIVE;
    const current = solar.mode === ThreeStateMode.Off
      ? this.Characteristic.CurrentHeaterCoolerState.INACTIVE
      : solar.mode === ThreeStateMode.On
        ? this.Characteristic.CurrentHeaterCoolerState.HEATING
        : this.Characteristic.CurrentHeaterCoolerState.IDLE;
    const target = solar.mode === ThreeStateMode.On
      ? this.Characteristic.TargetHeaterCoolerState.HEAT
      : this.Characteristic.TargetHeaterCoolerState.AUTO;

    service
      ?.updateCharacteristic(this.Characteristic.Active, active)
      .updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, current)
      .updateCharacteristic(this.Characteristic.TargetHeaterCoolerState, target)
      .updateCharacteristic(this.Characteristic.CurrentTemperature, status.temperature)
      .updateCharacteristic(
        this.Characteristic.HeatingThresholdTemperature,
        solar.set_temperature,
      );
  }

  private refreshValve(status: PoolStatus): void {
    const service = this.services[0];
    const mode = this.findValve(status).mode;
    service
      ?.updateCharacteristic(
        this.Characteristic.Active,
        mode === ThreeStateMode.Off
          ? this.Characteristic.Active.INACTIVE
          : this.Characteristic.Active.ACTIVE,
      )
      .updateCharacteristic(
        this.Characteristic.InUse,
        mode === ThreeStateMode.On
          ? this.Characteristic.InUse.IN_USE
          : this.Characteristic.InUse.NOT_IN_USE,
      );
  }

  private refreshLighting(status: PoolStatus): void {
    this.services[0]?.updateCharacteristic(
      this.Characteristic.On,
      this.findLighting(status).mode !== ThreeStateMode.Off,
    );
  }

  private refreshFavourite(status: PoolStatus): void {
    this.services[0]?.updateCharacteristic(
      this.Characteristic.On,
      status.active_favourite === this.descriptor.deviceNumber,
    );
  }

  private status(): PoolStatus {
    return this.runtime.getStatus();
  }

  private heater(): PoolStatus['heaters'][number] {
    return this.findHeater(this.status());
  }

  private solar(): PoolStatus['solar_systems'][number] {
    return this.findSolar(this.status());
  }

  private valve(): PoolStatus['valves'][number] {
    return this.findValve(this.status());
  }

  private lighting(): PoolStatus['lighting_zones'][number] {
    return this.findLighting(this.status());
  }

  private findHeater(status: PoolStatus): PoolStatus['heaters'][number] {
    const heater = status.heaters.find(
      (candidate) => candidate.heater_number === this.descriptor.deviceNumber,
    );
    if (!heater) {
      throw new Error(`Heater ${this.descriptor.deviceNumber} is missing from pool status.`);
    }
    return heater;
  }

  private findSolar(status: PoolStatus): PoolStatus['solar_systems'][number] {
    const solar = status.solar_systems.find(
      (candidate) => candidate.solar_number === this.descriptor.deviceNumber,
    );
    if (!solar) {
      throw new Error(`Solar system ${this.descriptor.deviceNumber} is missing from pool status.`);
    }
    return solar;
  }

  private findValve(status: PoolStatus): PoolStatus['valves'][number] {
    const valve = status.valves.find(
      (candidate) => candidate.valve_number === this.descriptor.deviceNumber,
    );
    if (!valve) {
      throw new Error(`Valve ${this.descriptor.deviceNumber} is missing from pool status.`);
    }
    return valve;
  }

  private findLighting(status: PoolStatus): PoolStatus['lighting_zones'][number] {
    const zone = status.lighting_zones.find(
      (candidate) => candidate.lighting_zone_number === this.descriptor.deviceNumber,
    );
    if (!zone) {
      throw new Error(`Lighting zone ${this.descriptor.deviceNumber} is missing from pool status.`);
    }
    return zone;
  }

  private heaterTargetTemperature(): number {
    const status = this.status();
    const heater = this.findHeater(status);
    return status.pool_spa_selection === PoolSpaSelection.Spa
      ? heater.spa_set_temperature
      : heater.set_temperature;
  }

  private currentHeaterState(): number {
    const status = this.status();
    if (this.findHeater(status).mode === HeaterMode.Off) {
      return this.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    return this.supportsCooling()
      && status.heat_cool_selection === HeatCoolSelection.Cooling
      ? this.Characteristic.CurrentHeaterCoolerState.COOLING
      : this.Characteristic.CurrentHeaterCoolerState.HEATING;
  }

  private targetHeaterState(): number {
    return this.supportsCooling()
      && this.status().heat_cool_selection === HeatCoolSelection.Cooling
      ? this.Characteristic.TargetHeaterCoolerState.COOL
      : this.Characteristic.TargetHeaterCoolerState.HEAT;
  }

  private supportsCooling(): boolean {
    return this.runtime.getConfiguration().heat_cool_selection_enabled;
  }

  private async setHeaterTemperature(value: CharacteristicValue): Promise<void> {
    await this.runtime.execute({
      actionCode: PoolActionCode.SetHeaterTemperature,
      deviceNumber: this.descriptor.deviceNumber,
      value: String(validateTemperature(value)),
    });
  }

  private isFavouriteActive(): boolean {
    return this.status().active_favourite === this.descriptor.deviceNumber;
  }
}

function asBoolean(value: CharacteristicValue): boolean {
  return value === true || value === 1;
}

function asNumber(value: CharacteristicValue): number {
  if (typeof value !== 'number') {
    throw new Error(`Expected a numeric HomeKit value, received ${typeof value}.`);
  }
  return value;
}

function validateTemperature(value: CharacteristicValue): number {
  const temperature = Math.round(asNumber(value));
  if (temperature < 10 || temperature > 40) {
    throw new Error('Target temperature must be between 10°C and 40°C.');
  }
  return temperature;
}
