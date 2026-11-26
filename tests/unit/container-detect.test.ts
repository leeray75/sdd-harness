import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDocker } from '../../src/main/env/container-detect';
import type { ContainerTransport } from '../../src/main/env/container-transport';
import {
  fakeDocker,
  type FakeContainer,
  type FakeDocker,
} from '../support/fake-container-transport';

// Dev container detection (D44, p4-env-container, AC10). It runs on the fake docker transport, so no docker program
// starts. It reports the CLI missing, the engine down, and the dev containers with their folder, config file, name and
// state; it leaves out a container whose folder fails the folder rule; and it never throws.

let base: string;
let containers: FakeContainer[];

/** A labelled container for the detection tests. */
function container(
  id: string,
  options: Partial<Omit<FakeContainer, 'id' | 'mount'>> = {},
): FakeContainer {
  const mount = join(base, id);
  mkdirSync(mount, { recursive: true });
  return {
    id,
    folder: options.folder ?? '/home/dev/project',
    metadata: options.metadata ?? null,
    running: options.running ?? true,
    created: options.created ?? '2026-11-20 10:00:00 +0000 UTC',
    mount,
    ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
    ...(options.name === undefined ? {} : { name: options.name }),
  };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'container-detect-'));
  containers = [];
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('detectDocker (AC10)', () => {
  it('reports the CLI missing when docker cannot start', async () => {
    expect(
      await detectDocker(
        { kind: 'host' },
        { transport: fakeDocker(containers, { dockerMissing: true }) },
      ),
    ).toEqual({
      cli: false,
    });
  });

  it('reports the engine down when the CLI runs but the engine does not answer', async () => {
    expect(
      await detectDocker(
        { kind: 'host' },
        { transport: fakeDocker(containers, { engineDown: true }) },
      ),
    ).toEqual({
      cli: true,
      engine: false,
    });
  });

  it('lists the dev containers with their folder, config file, name and state', async () => {
    containers.push(
      container('a', {
        folder: '/home/dev/one',
        configFile: '/home/dev/one/.devcontainer/devcontainer.json',
        name: 'one-dev',
      }),
      container('b', { folder: '/home/dev/two', running: false, name: 'two-dev' }),
    );
    const docker: FakeDocker = fakeDocker(containers);
    expect(await detectDocker({ kind: 'host' }, { transport: docker })).toEqual({
      cli: true,
      engine: true,
      containers: [
        {
          folder: '/home/dev/one',
          configFile: '/home/dev/one/.devcontainer/devcontainer.json',
          name: 'one-dev',
          running: true,
        },
        { folder: '/home/dev/two', configFile: null, name: 'two-dev', running: false },
      ],
    });
  });

  it('leaves out a container whose folder fails the folder rule', async () => {
    containers.push(
      container('good', { folder: '/home/dev/good' }),
      container('quote', { folder: '/home/dev/"bad"' }),
      container('dash', { folder: '-leading' }),
      container('control', { folder: '/home/dev/\u0007bell' }),
    );
    const found = await detectDocker({ kind: 'host' }, { transport: fakeDocker(containers) });
    expect(found).toMatchObject({ cli: true, engine: true });
    if (!('containers' in found)) throw new Error('the engine answered');
    expect(found.containers.map((item) => item.folder)).toEqual(['/home/dev/good']);
  });

  it('reports no containers when none has the label', async () => {
    expect(await detectDocker({ kind: 'host' }, { transport: fakeDocker([]) })).toEqual({
      cli: true,
      engine: true,
      containers: [],
    });
  });

  it('never throws, even when the transport itself fails', async () => {
    const broken: ContainerTransport = {
      run: () => Promise.reject(new Error('boom')),
    };
    await expect(detectDocker({ kind: 'host' }, { transport: broken })).resolves.toEqual({
      cli: false,
    });
  });

  it('asks docker for its version and the label listing, and inspects the labels', async () => {
    containers.push(container('a'));
    const docker = fakeDocker(containers);
    await detectDocker({ kind: 'host' }, { transport: docker });
    expect(docker.calls.map((call) => call.argv[0])).toEqual(['version', 'ps', 'inspect']);
    expect(docker.calls[1]?.argv).toContain('label=devcontainer.local_folder');
  });
});
