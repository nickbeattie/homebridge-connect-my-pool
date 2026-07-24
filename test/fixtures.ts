import type { PoolConfiguration, PoolStatus } from '../src/api/types.js';

export const fullConfiguration: PoolConfiguration = {
  pool_spa_selection_enabled: true,
  heat_cool_selection_enabled: true,
  has_heaters: true,
  has_solar_systems: true,
  has_channels: true,
  has_valves: true,
  has_lighting_zones: true,
  has_favourites: true,
  heaters: [{ heater_number: 1 }],
  solar_systems: [{ solar_number: 2 }],
  channels: [{ channel_number: 3, function: 1, name: 'Filter Pump' }],
  valves: [{ valve_number: 4, function: 1, name: 'Pool Valve' }],
  lighting_zones: [{
    lighting_zone_number: 5,
    name: 'Pool Light',
    color_enabled: true,
    colors_available: [{ color_number: 5, color_name: 'Blue' }],
  }],
  favourites: [{ favourite_number: 6, name: 'Night Swim' }],
};

export const fullStatus: PoolStatus = {
  pool_spa_selection: 1,
  heat_cool_selection: 1,
  temperature: 27,
  active_favourite: 6,
  heaters: [{
    heater_number: 1,
    mode: 1,
    set_temperature: 29,
    spa_set_temperature: 37,
  }],
  solar_systems: [{
    solar_number: 2,
    mode: 1,
    set_temperature: 30,
  }],
  channels: [{ channel_number: 3, mode: 1 }],
  valves: [{ valve_number: 4, mode: 1 }],
  lighting_zones: [{ lighting_zone_number: 5, mode: 1, color: 5 }],
};

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
