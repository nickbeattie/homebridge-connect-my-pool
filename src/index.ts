import type { API } from 'homebridge';

import { ConnectMyPoolPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, ConnectMyPoolPlatform);
};

export type { ConnectMyPoolPlatformConfig, ConfiguredPool } from './config.js';
