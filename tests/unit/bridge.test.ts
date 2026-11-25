import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { IPC_CHANNELS, toHarnessPlatform, type HarnessBridge } from '../../src/shared/bridge';
import type { HumanActionRequest, HumanActionResult } from '../../src/shared/human-actions';

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
}));

// The preload calls contextBridge at import time. The test records what it exposes.
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      electron.exposed.set(key, value);
    },
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

describe('toHarnessPlatform', () => {
  it('keeps darwin and linux', () => {
    expect(toHarnessPlatform('darwin')).toBe('darwin');
    expect(toHarnessPlatform('linux')).toBe('linux');
  });

  it('reports win32 and every other platform value as win32', () => {
    expect(toHarnessPlatform('win32')).toBe('win32');
    expect(toHarnessPlatform('freebsd')).toBe('win32');
    expect(toHarnessPlatform('')).toBe('win32');
    expect(toHarnessPlatform('Darwin')).toBe('win32');
  });
});

describe('the human-action channel name and member', () => {
  it('names the channel harness:human-action', () => {
    expect(IPC_CHANNELS.humanAction).toBe('harness:human-action');
  });

  it('gives the bridge a humanAction member with the request and result types', () => {
    expectTypeOf<HarnessBridge['humanAction']>().toEqualTypeOf<
      (request: HumanActionRequest) => Promise<HumanActionResult>
    >();
  });
});

describe('the preload bridge', () => {
  beforeEach(async () => {
    electron.invoke.mockReset();
    electron.invoke.mockResolvedValue({ ok: true });
    await import('../../src/preload/index');
  });

  it('exposes the harness global with the existing members and humanAction only', () => {
    const harness = electron.exposed.get('harness') as Record<string, unknown>;
    expect(Object.keys(harness).sort()).toEqual([
      'getVersion',
      'humanAction',
      'platform',
      'window',
    ]);
  });

  it('sends the request to the human-action channel through ipcRenderer.invoke', async () => {
    const harness = electron.exposed.get('harness') as HarnessBridge;
    const request = { action: 'approve-spec' as const, project: 'dev', feature: 'demo' };
    await expect(harness.humanAction(request)).resolves.toEqual({ ok: true });
    expect(electron.invoke).toHaveBeenCalledWith('harness:human-action', request);
  });
});
