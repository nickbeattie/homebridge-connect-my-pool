import {
  ACTION_POLL_INTERVAL_MS,
  ACTION_REQUEST_TIMEOUT_MS,
  ACTION_TIMEOUT_MS,
  CONNECT_MY_POOL_API_URL,
  REQUEST_TIMEOUT_MS,
} from '../settings.js';
import {
  ActionExecutionStatus,
  TemperatureScale,
  type PoolAction,
  type PoolActionResponse,
  type PoolConfiguration,
  type PoolStatus,
} from './types.js';
import {
  parseApiFailure,
  parsePoolActionResponse,
  parsePoolActionStatusResponse,
  parsePoolConfiguration,
  parsePoolStatus,
} from './validation.js';

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  actionPollIntervalMs?: number;
  actionRequestTimeoutMs?: number;
  actionTimeoutMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class ConnectMyPoolApiError extends Error {
  constructor(
    public readonly failureCode: number,
    message: string,
  ) {
    super(`ConnectMyPool API failure ${failureCode}: ${message}`);
    this.name = 'ConnectMyPoolApiError';
  }
}

export class ActionFailedError extends Error {
  constructor(
    public readonly executionStatus: ActionExecutionStatus,
    message: string,
  ) {
    super(message);
    this.name = 'ActionFailedError';
  }
}

export class ConnectMyPoolClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;
  private readonly actionPollIntervalMs: number;
  private readonly actionRequestTimeoutMs: number;
  private readonly actionTimeoutMs: number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly poolApiCode: string,
    options: ClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? CONNECT_MY_POOL_API_URL).replace(/\/+$/, '');
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.actionPollIntervalMs = options.actionPollIntervalMs ?? ACTION_POLL_INTERVAL_MS;
    this.actionRequestTimeoutMs =
      options.actionRequestTimeoutMs ?? ACTION_REQUEST_TIMEOUT_MS;
    this.actionTimeoutMs = options.actionTimeoutMs ?? ACTION_TIMEOUT_MS;
    this.sleep = options.sleep ?? abortableSleep;
  }

  async getConfiguration(signal?: AbortSignal): Promise<PoolConfiguration> {
    const response = await this.post('poolconfig', {}, signal);
    return parsePoolConfiguration(response);
  }

  async getStatus(signal?: AbortSignal): Promise<PoolStatus> {
    const response = await this.post(
      'poolstatus',
      { temperature_scale: TemperatureScale.Celsius },
      signal,
    );
    return parsePoolStatus(response);
  }

  async executeAction(action: PoolAction, signal?: AbortSignal): Promise<void> {
    const response = await this.submitAction(action, signal);
    await this.waitForAction(response, signal);
  }

  async submitAction(
    action: PoolAction,
    signal?: AbortSignal,
  ): Promise<PoolActionResponse> {
    const response = parsePoolActionResponse(
      await this.post(
        'poolaction',
        {
          action_code: action.actionCode,
          device_number: action.deviceNumber,
          value: action.value,
          temperature_scale: TemperatureScale.Celsius,
          wait_for_execution: false,
        },
        signal,
        this.actionRequestTimeoutMs,
      ),
    );

    if (response.execution_status !== ActionExecutionStatus.Waiting) {
      this.assertActionSucceeded(response.execution_status);
    }
    return response;
  }

  async waitForAction(
    action: PoolActionResponse,
    signal?: AbortSignal,
  ): Promise<void> {
    if (action.execution_status !== ActionExecutionStatus.Waiting) {
      this.assertActionSucceeded(action.execution_status);
      return;
    }

    const deadline = Date.now() + this.actionTimeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(this.actionPollIntervalMs, signal);
      const response = parsePoolActionStatusResponse(
        await this.post(
          'poolactionstatus',
          { action_number: action.action_number },
          signal,
        ),
      );
      if (response.execution_status !== ActionExecutionStatus.Waiting) {
        this.assertActionSucceeded(response.execution_status);
        return;
      }
    }

    throw new ActionFailedError(
      ActionExecutionStatus.TimedOut,
      `ConnectMyPool action ${action.action_number} did not complete within ${this.actionTimeoutMs}ms.`,
    );
  }

  private assertActionSucceeded(status: ActionExecutionStatus): void {
    if (status === ActionExecutionStatus.Succeeded) {
      return;
    }
    if (status === ActionExecutionStatus.Failed) {
      throw new ActionFailedError(status, 'ConnectMyPool reported that the action failed.');
    }
    if (status === ActionExecutionStatus.TimedOut) {
      throw new ActionFailedError(status, 'ConnectMyPool reported that the action timed out.');
    }
    throw new ActionFailedError(status, `ConnectMyPool returned unknown action status ${status}.`);
  }

  private async post(
    endpoint: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(
      () => controller.abort(new Error('Request timed out')),
      timeoutMs,
    );

    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          pool_api_code: this.poolApiCode,
          ...body,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`ConnectMyPool ${endpoint} returned HTTP ${response.status}.`);
      }

      const data: unknown = await response.json();
      const failure = parseApiFailure(data);
      if (failure) {
        throw new ConnectMyPoolApiError(
          failure.failure_code,
          failure.failure_description,
        );
      }
      return data;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw abortReason(signal);
  }

  await new Promise<void>((resolve, reject) => {
    const onComplete = (): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(onComplete, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new Error('Operation aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Operation aborted.');
}
