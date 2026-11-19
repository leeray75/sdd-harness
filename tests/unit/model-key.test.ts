import { describe, expect, it, vi } from 'vitest';
import { decideModelKey, SPIKE_KEY_NAME } from '../../src/main/agent/model-key';
import type { Logger } from '../../src/main/log';
import type { SecretStore } from '../../src/main/secrets/store';

const SENTINEL = 'SENTINEL-MODEL-KEY-4470';

/** A fake store that only implements read. */
function fakeStore(read: (name: string) => string | null): Pick<SecretStore, 'read'> {
  return { read: vi.fn(read) };
}

function fakeLogger() {
  const logger: Logger = {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  };
  return logger as Logger & {
    info: ReturnType<typeof vi.fn<(message: string) => void>>;
    error: ReturnType<typeof vi.fn<(message: string) => void>>;
  };
}

function allLogLines(logger: ReturnType<typeof fakeLogger>): string {
  return [...logger.info.mock.calls, ...logger.error.mock.calls]
    .map((call) => String(call[0]))
    .join('\n');
}

describe('decideModelKey', () => {
  it('uses the spike entry name', () => {
    expect(SPIKE_KEY_NAME).toBe('spike');
  });

  it('sends the stored key when the entry is present', () => {
    const store = fakeStore((name) => (name === 'spike' ? SENTINEL : null));
    const logger = fakeLogger();
    const message = decideModelKey({ spikeFlag: true, store, logger });
    expect(message).toEqual({ type: 'model-key', key: SENTINEL });
    expect(store.read).toHaveBeenCalledWith('spike');
    expect(allLogLines(logger)).not.toContain(SENTINEL);
  });

  it('sends null when the entry is absent', () => {
    const store = fakeStore(() => null);
    const logger = fakeLogger();
    expect(decideModelKey({ spikeFlag: true, store, logger })).toEqual({
      type: 'model-key',
      key: null,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a redacted error and sends null when the store throws', () => {
    const store = fakeStore(() => {
      throw new Error(`could not decrypt ${SENTINEL}`);
    });
    const logger = fakeLogger();
    const message = decideModelKey({ spikeFlag: true, store, logger });
    expect(message).toEqual({ type: 'model-key', key: null });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0]?.[0])).toMatch(/could not be read/);
    expect(allLogLines(logger)).not.toContain(SENTINEL);
  });

  it('sends nothing and does not read the store when the spike flag is off', () => {
    const store = fakeStore(() => SENTINEL);
    const logger = fakeLogger();
    expect(decideModelKey({ spikeFlag: false, store, logger })).toBeNull();
    expect(store.read).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('never logs the key on the present path', () => {
    const logger = fakeLogger();
    decideModelKey({ spikeFlag: true, store: fakeStore(() => SENTINEL), logger });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(allLogLines(logger)).not.toContain(SENTINEL);
  });
});
