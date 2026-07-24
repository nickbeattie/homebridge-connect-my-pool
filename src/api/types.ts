export enum TemperatureScale {
  Celsius = 0,
  Fahrenheit = 1,
}

export enum PoolSpaSelection {
  Spa = 0,
  Pool = 1,
}

export enum HeatCoolSelection {
  Cooling = 0,
  Heating = 1,
}

export enum HeaterMode {
  Off = 0,
  On = 1,
}

export enum ThreeStateMode {
  Off = 0,
  Auto = 1,
  On = 2,
}

export enum ActionExecutionStatus {
  Waiting = 0,
  Succeeded = 1,
  Failed = 2,
  TimedOut = 3,
}

export enum PoolActionCode {
  CycleChannelMode = 1,
  SetValveMode = 2,
  SetPoolSpaSelection = 3,
  SetHeaterMode = 4,
  SetHeaterTemperature = 5,
  SetLightingMode = 6,
  SetLightingColor = 7,
  SetActiveFavourite = 8,
  SetSolarMode = 9,
  SetSolarTemperature = 10,
  SyncLightingZone = 11,
  SetHeatCoolSelection = 12,
}

export interface PoolConfiguration {
  pool_spa_selection_enabled: boolean;
  heat_cool_selection_enabled: boolean;
  has_heaters: boolean;
  has_solar_systems: boolean;
  has_channels: boolean;
  has_valves: boolean;
  has_lighting_zones: boolean;
  has_favourites: boolean;
  heaters: Array<{ heater_number: number }>;
  solar_systems: Array<{ solar_number: number }>;
  channels: Array<{
    channel_number: number;
    function: number;
    name: string;
  }>;
  valves: Array<{
    valve_number: number;
    function: number;
    name: string;
  }>;
  lighting_zones: Array<{
    lighting_zone_number: number;
    name: string;
    color_enabled: boolean;
    colors_available: Array<{
      color_number: number;
      color_name: string;
    }>;
  }>;
  favourites: Array<{
    favourite_number: number;
    name: string;
  }>;
}

export interface PoolStatus {
  pool_spa_selection: number;
  heat_cool_selection: number;
  temperature: number;
  active_favourite: number;
  heaters: Array<{
    heater_number: number;
    mode: number;
    set_temperature: number;
    spa_set_temperature: number;
  }>;
  solar_systems: Array<{
    solar_number: number;
    mode: number;
    set_temperature: number;
  }>;
  channels: Array<{
    channel_number: number;
    mode: number;
  }>;
  valves: Array<{
    valve_number: number;
    mode: number;
  }>;
  lighting_zones: Array<{
    lighting_zone_number: number;
    mode: number;
    color?: number;
  }>;
}

export interface PoolAction {
  actionCode: PoolActionCode;
  deviceNumber: number;
  value: string;
}

export interface PoolActionResponse {
  action_number: number;
  execution_status: ActionExecutionStatus;
}

export interface PoolActionStatusResponse {
  execution_status: ActionExecutionStatus;
}

export interface ApiFailure {
  failure_code: number;
  failure_description: string;
}
