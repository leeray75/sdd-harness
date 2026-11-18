import type { HarnessBridge } from '../shared/bridge';

declare global {
  interface Window {
    harness: HarnessBridge;
  }
}

export {};
