import type { Logging } from 'homebridge';

import { ConnectMyPoolClient } from '../api/client.js';
import type {
  PoolAction,
  PoolActionResponse,
  PoolConfiguration,
  PoolStatus,
} from '../api/types.js';
import type { ConfiguredPool } from '../config.js';
import {
  CONFIG_REFRESH_INTERVAL_MS,
  CONFIG_RETRY_INTERVAL_MS,
} from '../settings.js';

type StateListener = () => void;
type ConfigurationListener = (configuration: PoolConfiguration) => void;

export interface PoolRuntimeOptions {
  client?: ConnectMyPoolClient;
  configRefreshIntervalMs?: number;
  configRetryIntervalMs?: number;
}

export class PoolRuntime {
  private readonly client: ConnectMyPoolClient;
  private readonly abortController = new AbortController();
  private readonly stateListeners = new Set<StateListener>();
  private readonly configurationListeners = new Set<ConfigurationListener>();
  private readonly configRefreshIntervalMs: number;
  private readonly configRetryIntervalMs: number;

  private configuration: PoolConfiguration | undefined;
  private status: PoolStatus | undefined;
  private statusError: Error | null = null;
  private configurationError: Error | null = null;
  private actionError: Error | null = null;
  private lastStatusAt = 0;
  private statusRequest: Promise<PoolStatus> | undefined;
  private configurationRequest: Promise<PoolConfiguration> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private configurationTimer: ReturnType<typeof setTimeout> | undefined;
  private actionSubmissionTail: Promise<void> = Promise.resolve();
  private consecutiveConfigurationFailures = 0;
  private stopped = false;

  constructor(
    public readonly pool: ConfiguredPool,
    private readonly pollIntervalMs: number,
    private readonly log: Logging,
    options: PoolRuntimeOptions = {},
  ) {
    this.client = options.client ?? new ConnectMyPoolClient(pool.poolApiCode);
    this.configRefreshIntervalMs =
      options.configRefreshIntervalMs ?? CONFIG_REFRESH_INTERVAL_MS;
    this.configRetryIntervalMs =
      options.configRetryIntervalMs ?? CONFIG_RETRY_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error(`Cannot start stopped pool runtime "${this.pool.id}".`);
    }

    const [configurationResult, statusResult] = await Promise.allSettled([
      this.refreshConfiguration(),
      this.refreshStatus(true),
    ]);
    this.scheduleConfigurationRefresh();
    this.scheduleStatusRefresh();

    if (configurationResult.status === 'rejected') {
      throw configurationResult.reason;
    }
    if (statusResult.status === 'rejected') {
      throw statusResult.reason;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    if (this.configurationTimer) {
      clearTimeout(this.configurationTimer);
    }
    this.abortController.abort(new Error(`Pool runtime "${this.pool.id}" stopped.`));
    this.stateListeners.clear();
    this.configurationListeners.clear();
  }

  getConfiguration(): PoolConfiguration {
    if (!this.configuration) {
      throw new Error(`No configuration is available for pool "${this.pool.id}".`);
    }
    return this.configuration;
  }

  getStatus(): PoolStatus {
    if (!this.status) {
      throw new Error(`No status is available for pool "${this.pool.id}".`);
    }
    return this.status;
  }

  hasFault(): boolean {
    return this.statusError !== null
      || this.configurationError !== null
      || this.actionError !== null;
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onConfiguration(listener: ConfigurationListener): () => void {
    this.configurationListeners.add(listener);
    return () => this.configurationListeners.delete(listener);
  }

  async refreshConfiguration(): Promise<PoolConfiguration> {
    if (this.configurationRequest) {
      return this.configurationRequest;
    }

    this.configurationRequest = this.client
      .getConfiguration(this.abortController.signal)
      .then((configuration) => {
        this.configuration = configuration;
        this.configurationError = null;
        this.consecutiveConfigurationFailures = 0;
        for (const listener of this.configurationListeners) {
          listener(configuration);
        }
        this.emitState();
        return configuration;
      })
      .catch((error: unknown) => {
        const normalized = normalizeError(error);
        this.configurationError = normalized;
        this.consecutiveConfigurationFailures += 1;
        this.log.error(
          `[${this.pool.name}] Configuration refresh failed: ${normalized.message}`,
        );
        this.emitState();
        throw normalized;
      })
      .finally(() => {
        this.configurationRequest = undefined;
      });

    return this.configurationRequest;
  }

  async refreshStatus(force = false): Promise<PoolStatus> {
    if (this.statusRequest) {
      return this.statusRequest;
    }
    if (!force && this.status && Date.now() - this.lastStatusAt < this.pollIntervalMs) {
      return this.status;
    }

    this.statusRequest = this.client
      .getStatus(this.abortController.signal)
      .then((status) => {
        this.status = status;
        this.lastStatusAt = Date.now();
        this.statusError = null;
        this.actionError = null;
        this.emitState();
        return status;
      })
      .catch((error: unknown) => {
        const normalized = normalizeError(error);
        this.statusError = normalized;
        this.log.error(`[${this.pool.name}] Status refresh failed: ${normalized.message}`);
        this.emitState();
        throw normalized;
      })
      .finally(() => {
        this.statusRequest = undefined;
      });

    return this.statusRequest;
  }

  execute(action: PoolAction): Promise<void> {
    const submission = this.actionSubmissionTail.then(() => (
      this.client.submitAction(action, this.abortController.signal)
    ));
    this.actionSubmissionTail = submission.then(
      () => undefined,
      () => undefined,
    );

    return submission.then(
      (response) => {
        void this.finishAcceptedAction(response);
      },
      (error: unknown) => {
        const normalized = this.recordActionError(error);
        throw normalized;
      },
    );
  }

  private scheduleStatusRefresh(): void {
    if (this.stopped) {
      return;
    }
    this.statusTimer = setTimeout(() => {
      void this.refreshStatus()
        .catch(() => undefined)
        .finally(() => this.scheduleStatusRefresh());
    }, this.pollIntervalMs);
    this.statusTimer.unref();
  }

  private scheduleConfigurationRefresh(): void {
    if (this.stopped) {
      return;
    }
    const retryMultiplier = 2 ** Math.min(
      Math.max(this.consecutiveConfigurationFailures - 1, 0),
      6,
    );
    const delay = this.consecutiveConfigurationFailures === 0
      ? this.configRefreshIntervalMs
      : Math.min(
          this.configRefreshIntervalMs,
          this.configRetryIntervalMs * retryMultiplier,
        );

    this.configurationTimer = setTimeout(() => {
      void this.refreshConfiguration()
        .catch(() => undefined)
        .finally(() => this.scheduleConfigurationRefresh());
    }, delay);
    this.configurationTimer.unref();
  }

  private async finishAcceptedAction(response: PoolActionResponse): Promise<void> {
    try {
      await this.client.waitForAction(response, this.abortController.signal);
    } catch (error: unknown) {
      this.recordActionError(error);
      return;
    }

    if (this.stopped) {
      return;
    }

    this.actionError = null;
    this.emitState();
    await this.refreshStatus(true).catch(() => undefined);
  }

  private recordActionError(value: unknown): Error {
    const normalized = normalizeError(value);
    if (!this.stopped) {
      this.actionError = normalized;
      this.log.error(`[${this.pool.name}] Action failed: ${normalized.message}`);
      this.emitState();
    }
    return normalized;
  }

  private emitState(): void {
    for (const listener of this.stateListeners) {
      listener();
    }
  }
}

function normalizeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
