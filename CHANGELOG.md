# Changelog

All notable changes to SDD Harness are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Frameless window** (`p0-window-chrome`, PR #3): `frame: false` on Windows and Linux, `titleBarStyle: 'hiddenInset'` with the native traffic lights on macOS. Default size 1280×800, minimum 1024×680.
- **Custom 40px title bar** (`src/renderer/TitleBar.tsx`):
  - it shows the app mark and an empty Location slot, and drags the window;
  - on Windows and Linux it has Minimize, Maximize/Restore and Close buttons (46×40) with accessible names, hover styles and a visible focus ring;
  - on macOS it leaves room for the traffic lights.
- **Window controls bridge** (D20): `window.harness.platform` and `window.harness.window` (`minimize`, `toggleMaximize`, `close`, `isMaximized`, `onMaximizedChange`). Main answers each call only from the app's own window and sends the maximized state back as a boolean-only event.
- **Tests:**
  - unit and e2e tests proving `window.open` is denied and foreign navigation is blocked (the guards now live in the pure `applyNavigationGuards`);
  - e2e tests for the title bar and the window controls;
  - the smoke test checks the new bridge keys.
- **Design tokens** (`p0-design-tokens`, PR #4, D21): every colour, type, spacing, height and radius token from design-notes §2–4 in `src/shared/tokens.ts` and `src/renderer/styles/tokens.css` (87 tokens), plus the new `titlebar/close-hover` token. A unit test keeps the two files equal, and another fails on any hex colour outside `tokens.css`.
- **Bundled fonts:** Inter (400–700) and JetBrains Mono (400, 500) through @fontsource, with no CSP change.
- **Base styles** (`src/renderer/styles/base.css`): the app background, primary text colour, Inter and one 2px accent focus ring. This fixes the shell's unreadable black-on-black text.
- **Button and Chip components:** Button (primary, gate, secondary, ghost, danger; 40px and 32px; disabled) and Chip (neutral, accent, amber, green, red; span or 28px button), with hover and pressed states. Tests check their contrast against WCAG AA.
- **Component gallery:** every Button and Chip variant and the font weights, shown under `pnpm dev` or with `HARNESS_GALLERY=1`.

### Changed

- The title bar and the window's background colour now use the design tokens instead of local values.

### Known issues

- Dragging the window by the title bar has no automated check.
- One e2e run crashed at launch (worker exit code 3221226505) and passed on rerun; not yet reproduced.

## [0.1.0] - 2026-11-17

The first version: the Phase 0 scaffold, as far as subtasks 1 and 2.

### Added

- **Toolchain** (`p0-toolchain-and-skeleton`, PR #1):
  - pnpm pinned through Corepack (D14);
  - Node 24 LTS (D18);
  - electron-vite builds, and electron-builder packages unsigned builds for the current OS (D15);
  - React with strict TypeScript, pinned to the 6.x line until typescript-eslint supports 7 (D15, D16);
  - ESLint flat config and Prettier (D16);
  - Vitest unit tests and Playwright-for-Electron e2e tests (D17).
- **Secure Electron skeleton:**
  - the main window runs with `contextIsolation`, `sandbox`, no `nodeIntegration` and `webSecurity`;
  - `window.open` is denied, and navigation and redirects to foreign URLs are blocked;
  - the production page has a strict CSP (`'self'` only), relaxed only under the Vite dev server, and the build fails if the two policies drift apart.
- **Typed preload bridge:** `window.harness.getVersion()` is the only call exposed to the renderer. Its contract is in `src/shared/bridge.ts`, and main answers only when the request comes from the app's own window.
- **Empty React shell:** it shows the app version read through the bridge.
- **Agent process** (`p0-process-layout`, PR #2): an Electron `utilityProcess` stub (`src/agent/index.ts`) that main starts after the app is ready and stops on quit. An unexpected exit is logged, and the agent is not restarted (D19).
- **Typed agent channel:** `src/shared/agent-protocol.ts` defines the handshake, ping/pong, and the tool call request and result messages. Main checks every agent message with bounded, hand-written guards, and rejects and logs any that are malformed. No message exists for human-only actions (D3).
- **Default-deny policy gate:** `src/main/policy/gate.ts` checks every agent tool call request and denies it with a reason. The router returns the denial to the agent as an error result, and nothing is executed.
- **Tests:**
  - unit tests for the navigation and sender checks, the protocol guards, the gate and the router;
  - an e2e smoke test proving the renderer can't reach `require`, `process` or `module`;
  - an e2e test proving a tool call from the agent process comes back denied.
- **Commands:** `pnpm dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test`, `e2e` and `package`, documented in `CLAUDE.md`.
- **Docs:**
  - decisions D14–D19 in `docs/decisions.md`;
  - the Phase 0 plan and progress file (`docs/phases/phase-00-progress.md`), with Phase 0 marked in progress in `docs/roadmap.md`;
  - the spec, tasks, build ledger and summary report for both subtasks in `docs/specs/`.

### Changed

- Prettier reformatted the existing Markdown docs. Only table alignment and blank lines changed; no text did.

### Known issues

- The agent process receives a full copy of the app's environment. It should get an allowlisted environment before Phase 1.
- Strings the agent supplies (such as the tool name) are logged without escaping newlines or control characters.
- `pnpm e2e` and `pnpm package` have only been run on Windows. CI for macOS and Linux comes in `p0-ci`.

[Unreleased]: https://github.com/leeray75/sdd-harness/commits/main
[0.1.0]: https://github.com/leeray75/sdd-harness/commits/main
