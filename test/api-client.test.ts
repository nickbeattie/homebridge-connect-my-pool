import { describe, expect, it, vi } from 'vitest';

import {
  ActionFailedError,
  ConnectMyPoolApiError,
  ConnectMyPoolClient,
} from '../src/api/client.js';
import {
  ActionExecutionStatus,
  PoolActionCode,
} from '../src/api/types.js';
import { fullConfiguration, fullStatus, jsonResponse } from './fixtures.js';

describe('ConnectMyPoolClient', () => {
  it('encodes authenticated reads and validates responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(fullConfiguration))
      .mockResolvedValueOnce(jsonResponse(fullStatus));
    const client = new ConnectMyPoolClient('super-secret', {
      baseUrl: 'https://example.test/api/',
      fetch,
    });

    await expect(client.getConfiguration()).resolves.toEqual(fullConfiguration);
    await expect(client.getStatus()).resolves.toEqual(fullStatus);

    const firstBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(firstBody).toEqual({ pool_api_code: 'super-secret' });
    expect(secondBody).toEqual({
      pool_api_code: 'super-secret',
      temperature_scale: 0,
    });
  });

  it('submits the published action shape and polls until success', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({
        action_number: 42,
        execution_status: ActionExecutionStatus.Waiting,
      }))
      .mockResolvedValueOnce(jsonResponse({
        execution_status: ActionExecutionStatus.Waiting,
      }))
      .mockResolvedValueOnce(jsonResponse({
        execution_status: ActionExecutionStatus.Succeeded,
      }));
    const sleep = vi.fn(async () => undefined);
    const client = new ConnectMyPoolClient('secret', {
      baseUrl: 'https://example.test/api',
      fetch,
      sleep,
    });

    await client.executeAction({
      actionCode: PoolActionCode.SetLightingMode,
      deviceNumber: 5,
      value: '1',
    });

    const actionBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(actionBody).toEqual({
      pool_api_code: 'secret',
      action_code: PoolActionCode.SetLightingMode,
      device_number: 5,
      value: '1',
      temperature_scale: 0,
      wait_for_execution: false,
    });
    expect(fetch.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
      'https://example.test/api/poolactionstatus',
      'https://example.test/api/poolactionstatus',
    ]);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed action', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        action_number: 9,
        execution_status: ActionExecutionStatus.Failed,
      }),
    );
    const client = new ConnectMyPoolClient('secret', {
      baseUrl: 'https://example.test/api',
      fetch,
    });

    await expect(client.executeAction({
      actionCode: PoolActionCode.SetHeaterMode,
      deviceNumber: 1,
      value: '1',
    })).rejects.toBeInstanceOf(ActionFailedError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('translates vendor failures without exposing the request secret', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({ failure_code: 6, failure_description: 'Time Throttle Exceeded' }),
    );
    const client = new ConnectMyPoolClient('do-not-leak', {
      baseUrl: 'https://example.test/api',
      fetch,
    });

    const error = await client.getStatus().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConnectMyPoolApiError);
    expect(String(error)).not.toContain('do-not-leak');
  });

  it('rejects malformed successful responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({ heaters: 'not-an-array' }),
    );
    const client = new ConnectMyPoolClient('secret', {
      baseUrl: 'https://example.test/api',
      fetch,
    });

    await expect(client.getConfiguration()).rejects.toThrow('invalid response');
  });

  it('bounds action acceptance to the HomeKit write-response budget', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      })
    ));
    const client = new ConnectMyPoolClient('secret', {
      baseUrl: 'https://example.test/api',
      fetch,
      actionRequestTimeoutMs: 2_500,
    });

    try {
      const submission = client.submitAction({
        actionCode: PoolActionCode.SetLightingMode,
        deviceNumber: 5,
        value: '2',
      });
      const rejection = expect(submission).rejects.toThrow('Request timed out');
      await vi.advanceTimersByTimeAsync(2_500);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
