import { describe, expect, it, vi } from 'vitest';
import { agentEnv } from '../../src/main/agent/host';

// host.ts imports Electron for the fork and the quit hook. The env function does not use it.
vi.mock('electron', () => ({
  app: { once: vi.fn() },
  utilityProcess: { fork: vi.fn() },
}));

// Linux spelling of the OS basics: names as the allowlist writes them.
const OS_BASICS = {
  PATH: '/usr/bin',
  Path: '/opt/bin',
  SystemRoot: 'C:\\Windows',
  WINDIR: 'C:\\Windows',
  TEMP: '/tmp',
  TMP: '/tmp',
  HOME: '/home/user',
  USERPROFILE: 'C:\\Users\\user',
  LANG: 'en_GB.UTF-8',
};

// Windows spelling, as the parent environment often has it.
const WIN_BASICS = {
  PATH: 'C:\\Windows\\system32',
  SYSTEMROOT: 'C:\\WINDOWS',
  WINDIR: 'C:\\WINDOWS',
  TEMP: 'C:\\Temp',
  TMP: 'C:\\Temp',
  HOME: 'C:\\Users\\user',
  USERPROFILE: 'C:\\Users\\user',
  LANG: 'en_GB.UTF-8',
};

const SPIKE = {
  HARNESS_SPIKE_BASE_URL: 'http://gateway.example:4100/v1',
  HARNESS_SPIKE_MODEL: 'some-model',
};

// The spike key is no longer an environment variable (D25). The parent may still have one set
// from older runs; the agent env must drop it either way.
const SPIKE_KEY = { HARNESS_SPIKE_API_KEY: 'spike-key-value' };
const WEAK_OVERRIDE = { HARNESS_ALLOW_WEAK_SECRETS: '1' };

const APP_SECRETS = {
  ANTHROPIC_API_KEY: 'anthropic-secret',
  AGENTGATEWAY_API_KEY: 'gateway-secret',
  HARNESS_SPIKE_ROOT: 'C:\\private\\root',
  COMSPEC: 'C:\\WINDOWS\\system32\\cmd.exe',
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--inspect',
  npm_config_registry: 'https://registry.example',
};

describe('agentEnv: the allowlist on Linux (case-sensitive)', () => {
  it('passes the OS basics it is allowed, with WINDIR among them', () => {
    expect(agentEnv({ ...OS_BASICS }, 'linux')).toEqual(OS_BASICS);
  });

  it('drops every other variable, including app secrets, the root and COMSPEC', () => {
    const env = agentEnv({ ...OS_BASICS, ...APP_SECRETS }, 'linux');
    expect(env).toEqual(OS_BASICS);
    for (const name of Object.keys(APP_SECRETS)) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it('never passes the secrets by value, even under an allowed name', () => {
    const env = agentEnv({ ...OS_BASICS, ...APP_SECRETS }, 'linux');
    expect(Object.values(env)).not.toContain('anthropic-secret');
    expect(Object.values(env)).not.toContain('gateway-secret');
  });

  it('matches names exactly: an upper-case SYSTEMROOT is dropped, SystemRoot passes', () => {
    expect(agentEnv({ SYSTEMROOT: 'C:\\WINDOWS' }, 'linux')).toEqual({});
    expect(agentEnv({ SystemRoot: 'C:\\WINDOWS' }, 'linux')).toEqual({ SystemRoot: 'C:\\WINDOWS' });
  });

  it('drops differently cased names such as path, lang and Home', () => {
    expect(agentEnv({ path: '/x', lang: 'fr', Home: '/h' }, 'linux')).toEqual({});
  });

  it('passes an empty environment as an empty object', () => {
    expect(agentEnv({}, 'linux')).toEqual({});
  });
});

describe('agentEnv: the allowlist on win32 (case-insensitive)', () => {
  it('passes SYSTEMROOT, WINDIR and PATH in the parent spelling', () => {
    expect(agentEnv({ ...WIN_BASICS }, 'win32')).toEqual(WIN_BASICS);
  });

  it('passes a differently cased name and keeps the parent spelling', () => {
    expect(agentEnv({ windir: 'C:\\WINDOWS' }, 'win32')).toEqual({ windir: 'C:\\WINDOWS' });
    expect(agentEnv({ Path: 'C:\\bin' }, 'win32')).toEqual({ Path: 'C:\\bin' });
  });

  it('passes a name once when the parent has it in two spellings, keeping the first', () => {
    const env = agentEnv({ PATH: 'first', Path: 'second' }, 'win32');
    expect(env).toEqual({ PATH: 'first' });
  });

  it('drops COMSPEC and the app secrets, in any case', () => {
    const env = agentEnv({ ...WIN_BASICS, ...APP_SECRETS, comspec: 'x' }, 'win32');
    expect(env).toEqual(WIN_BASICS);
    expect(env).not.toHaveProperty('COMSPEC');
    expect(env).not.toHaveProperty('comspec');
    expect(env).not.toHaveProperty('HARNESS_SPIKE_ROOT');
  });
});

describe('agentEnv: the flags', () => {
  it('passes the self-check flag when it is set', () => {
    expect(agentEnv({ HARNESS_AGENT_SELFCHECK: '1' }, 'linux')).toEqual({
      HARNESS_AGENT_SELFCHECK: '1',
    });
  });

  it('passes the spike flag itself, whatever its value', () => {
    expect(agentEnv({ HARNESS_AGENT_SPIKE: '0' }, 'linux')).toEqual({ HARNESS_AGENT_SPIKE: '0' });
  });

  it('omits flags that are not set', () => {
    expect(agentEnv({ PATH: '/usr/bin' }, 'linux')).not.toHaveProperty('HARNESS_AGENT_SELFCHECK');
    expect(agentEnv({ PATH: '/usr/bin' }, 'linux')).not.toHaveProperty('HARNESS_AGENT_SPIKE');
  });
});

describe('agentEnv: the spike variables', () => {
  it('passes the spike variables only when HARNESS_AGENT_SPIKE is 1', () => {
    const env = agentEnv({ ...OS_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE }, 'linux');
    expect(env).toEqual({ ...OS_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE });
  });

  it('drops HARNESS_SPIKE_API_KEY with the spike flag on, and never passes a key variable', () => {
    const env = agentEnv(
      { ...OS_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE, ...SPIKE_KEY },
      'linux',
    );
    expect(env).not.toHaveProperty('HARNESS_SPIKE_API_KEY');
    expect(Object.values(env)).not.toContain('spike-key-value');
    expect(env).toEqual({ ...OS_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE });
  });

  it('passes HARNESS_SPIKE_PROVIDER only with the spike flag on', () => {
    const on = agentEnv(
      { ...OS_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE, HARNESS_SPIKE_PROVIDER: 'anthropic' },
      'linux',
    );
    expect(on).toHaveProperty('HARNESS_SPIKE_PROVIDER', 'anthropic');
    const off = agentEnv(
      { ...OS_BASICS, HARNESS_AGENT_SPIKE: '0', HARNESS_SPIKE_PROVIDER: 'anthropic' },
      'linux',
    );
    expect(off).not.toHaveProperty('HARNESS_SPIKE_PROVIDER');
  });

  it('drops HARNESS_SPIKE_API_KEY with the spike flag off', () => {
    const env = agentEnv({ ...OS_BASICS, HARNESS_AGENT_SPIKE: '0', ...SPIKE_KEY }, 'linux');
    expect(env).not.toHaveProperty('HARNESS_SPIKE_API_KEY');
  });

  it('drops HARNESS_SPIKE_API_KEY in any case on win32 with the flag on', () => {
    const env = agentEnv(
      { ...WIN_BASICS, HARNESS_AGENT_SPIKE: '1', harness_spike_api_key: 'spike-key-value' },
      'win32',
    );
    expect(env).not.toHaveProperty('harness_spike_api_key');
    expect(env).not.toHaveProperty('HARNESS_SPIKE_API_KEY');
    expect(Object.values(env)).not.toContain('spike-key-value');
  });

  it('drops HARNESS_ALLOW_WEAK_SECRETS with the spike flag on and off, on both platforms', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const basics = platform === 'win32' ? WIN_BASICS : OS_BASICS;
      for (const flag of ['1', '0']) {
        const env = agentEnv({ ...basics, HARNESS_AGENT_SPIKE: flag, ...WEAK_OVERRIDE }, platform);
        expect(env).not.toHaveProperty('HARNESS_ALLOW_WEAK_SECRETS');
        expect(env).toEqual({ ...basics, HARNESS_AGENT_SPIKE: flag });
      }
    }
  });

  it('drops the spike variables when the spike flag is 0', () => {
    const env = agentEnv({ ...OS_BASICS, HARNESS_AGENT_SPIKE: '0', ...SPIKE }, 'linux');
    for (const name of Object.keys(SPIKE)) {
      expect(env).not.toHaveProperty(name);
    }
    expect(env).toEqual({ ...OS_BASICS, HARNESS_AGENT_SPIKE: '0' });
  });

  it('drops the spike variables when the spike flag is absent', () => {
    const env = agentEnv({ ...OS_BASICS, ...SPIKE }, 'linux');
    for (const name of Object.keys(SPIKE)) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it('drops the spike variables when the flag is off on win32 too', () => {
    const env = agentEnv({ ...WIN_BASICS, HARNESS_AGENT_SPIKE: '0', ...SPIKE }, 'win32');
    for (const name of Object.keys(SPIKE)) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it('passes the spike variables on win32 when the flag is 1, and still drops the root', () => {
    const env = agentEnv(
      { ...WIN_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE, ...APP_SECRETS },
      'win32',
    );
    expect(env).toEqual({ ...WIN_BASICS, HARNESS_AGENT_SPIKE: '1', ...SPIKE });
    expect(env).not.toHaveProperty('HARNESS_SPIKE_ROOT');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });
});
