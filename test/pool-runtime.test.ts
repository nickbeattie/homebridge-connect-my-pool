import type { Logging } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { ConnectMyPoolClient } from '../src/api/client.js';
import {
  ActionExecutionStatus,
  PoolActionCode,
} from '../src/api/types.js';
import type { ConfiguredPool } from '../src/config.js';
import { PoolRuntime } from '../src/runtime/pool-runtime.js';
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

describe('PoolRuntime', () => {
  it('starts with one configuration and status request and retains last-known state', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/poolconfig')) {
        return jsonResponse(fullConfiguration);
      }
      return jsonResponse(fullStatus);
    });
    const runtime = createRuntime(fetch);

    await runtime.start();
    expect(runtime.getConfiguration()).toEqual(fullConfiguration);
    expect(runtime.getStatus()).toEqual(fullStatus);
    expect(fetch).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it('deduplicates concurrent status refreshes', async () => {
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(() => pending);
    const runtime = createRuntime(fetch);

    const first = runtime.refreshStatus(true);
    const second = runtime.refreshStatus(true);
    resolveResponse(jsonResponse(fullStatus));

    await expect(Promise.all([first, second])).resolves.toEqual([
      fullStatus,
      fullStatus,
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it('serializes actions and refreshes status after each success', async () => {
    let activeActions = 0;
    let maximumActiveActions = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const endpoint = String(url);
      if (endpoint.endsWith('/poolaction')) {
        activeActions += 1;
        maximumActiveActions = Math.max(maximumActiveActions, activeActions);
        await Promise.resolve();
        activeActions -= 1;
        return jsonResponse({
          action_number: 1,
          execution_status: ActionExecutionStatus.Succeeded,
        });
      }
      return jsonResponse(fullStatus);
    });
    const runtime = createRuntime(fetch);

    await Promise.all([
      runtime.execute({
        actionCode: PoolActionCode.SetLightingMode,
        deviceNumber: 5,
        value: '2',
      }),
      runtime.execute({
        actionCode: PoolActionCode.SetHeaterMode,
        deviceNumber: 1,
        value: '1',
      }),
    ]);

    expect(maximumActiveActions).toBe(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/poolaction')))
      .toHaveLength(2);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/poolstatus')))
      .toHaveLength(2);
    runtime.stop();
  });

  it('returns after ordered action submission without waiting for cloud execution', async () => {
    let actionNumber = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/poolaction')) {
        actionNumber += 1;
        return jsonResponse({
          action_number: actionNumber,
          execution_status: ActionExecutionStatus.Waiting,
        });
      }
      return jsonResponse({ execution_status: ActionExecutionStatus.Waiting });
    });
    const client = new ConnectMyPoolClient(pool.poolApiCode, {
      baseUrl: 'https://example.test/api',
      fetch,
      sleep: async (_milliseconds, signal) => (
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new Error('stopped')),
            { once: true },
          );
        })
      ),
    });
    const runtime = new PoolRuntime(pool, 60_000, createLogger(), { client });

    await expect(Promise.all([
      runtime.execute({
        actionCode: PoolActionCode.SetLightingMode,
        deviceNumber: 5,
        value: '2',
      }),
      runtime.execute({
        actionCode: PoolActionCode.SetHeaterMode,
        deviceNumber: 1,
        value: '1',
      }),
    ])).resolves.toEqual([undefined, undefined]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://example.test/api/poolaction',
      'https://example.test/api/poolaction',
    ]);
    runtime.stop();
  });

  it('retries failed startup configuration discovery on a short backoff', async () => {
    vi.useFakeTimers();
    let configurationRequests = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith('/poolconfig')) {
        configurationRequests += 1;
        return configurationRequests === 1
          ? jsonResponse({
              failure_code: 6,
              failure_description: 'Time Throttle Exceeded',
            })
          : jsonResponse(fullConfiguration);
      }
      return jsonResponse(fullStatus);
    });
    const client = new ConnectMyPoolClient(pool.poolApiCode, {
      baseUrl: 'https://example.test/api',
      fetch,
    });
    const runtime = new PoolRuntime(pool, 60_000, createLogger(), {
      client,
      configRefreshIntervalMs: 1_000,
      configRetryIntervalMs: 10,
    });

    try {
      await expect(runtime.start()).rejects.toThrow('Time Throttle Exceeded');
      expect(configurationRequests).toBe(1);

      await vi.advanceTimersByTimeAsync(10);

      expect(configurationRequests).toBe(2);
      expect(runtime.getConfiguration()).toEqual(fullConfiguration);
    } finally {
      runtime.stop();
      vi.useRealTimers();
    }
  });

  it('preserves valid configuration when a later discovery request fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(fullConfiguration))
      .mockResolvedValueOnce(jsonResponse({
        failure_code: 7,
        failure_description: 'Pool Not Connected',
      }));
    const runtime = createRuntime(fetch);

    await runtime.refreshConfiguration();
    await expect(runtime.refreshConfiguration()).rejects.toThrow('Pool Not Connected');
    expect(runtime.getConfiguration()).toEqual(fullConfiguration);
    expect(runtime.hasFault()).toBe(true);
    runtime.stop();
  });
});

function createRuntime(fetch: typeof globalThis.fetch): PoolRuntime {
  const client = new ConnectMyPoolClient(pool.poolApiCode, {
    baseUrl: 'https://example.test/api',
    fetch,
    actionPollIntervalMs: 0,
  });
  return new PoolRuntime(
    pool,
    60_000,
    createLogger(),
    { client, configRefreshIntervalMs: 3_600_000 },
  );
}

function createLogger(): Logging {
  const logger = vi.fn() as unknown as Logging;
  logger.info = vi.fn();
  logger.warn = vi.fn();
  logger.error = vi.fn();
  logger.debug = vi.fn();
  logger.log = vi.fn();
  logger.success = vi.fn();
  logger.prefix = 'test';
  return logger;
}
