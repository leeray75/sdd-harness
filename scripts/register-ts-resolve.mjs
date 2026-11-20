// Dev-only: registers the resolve hook that lets the probe recorder import the agent's TypeScript
// modules under native Node (p1-model-probes). Loaded with `node --import` by `pnpm record:probes`.

import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
