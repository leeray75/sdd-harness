# SDD Harness — Design notes

17 Nov 2026 · Companion to [`PRD.md`](PRD.md) and [`workflow.md`](workflow.md)

The 16 screens in [`design/`](design/README.md) are the source of truth for layout, copy and exact values: `design/screens/*.dc.html` hold the markup with inline styles, `design/png/*.png` show how each renders. These notes explain the system behind them and cover what static screens don't show: states, behaviour and rules. The app enforces the workflow itself; nothing in the UI depends on Claude Code hooks or typed commands.

| Page | Screens (files) |
| --- | --- |
| 1 · Workspace | New feature (`Flow0Empty`), Pick a ticket (`Flow1Start`), Plan and approve the spec (`Main`), Start the build (`Flow3Approved`), Building (`Flow4Building`), Review the result (`Flow5Done`), Shipped (`Flow6Closed`) |
| 2 · Build run | Running (`Build`), Paused for a spec problem (`Build2Paused`), Round limit reached (`Build3Limit`) |
| 3 · Models and agents | Overview with tool permissions (`Providers`), Add a server (`Models2Add`), Test and assign (`Models3Test`) |
| 4 · Projects | Projects and Needs you (`Projects`), Add project: where (`Projects2Env`), checks and rules (`Projects3Setup`) |

## 1. Principles

1. **Click, don't type commands.** Every workflow step is a button. The message box is for talking to Claude, never for driving the workflow.
2. **One next action, always visible.** The Next bar above the message box holds the single recommended action, with at most two alternatives.
3. **Documents are always on screen.** Story, Plan, Spec, Tasks, Ticket and Report sit in a pane at the top of the Workspace and update live.
4. **Human-only actions look different.** Approve the spec, approve the result, change an approved spec and decide after the round limit use amber, and nothing else does. Blue means the app or an agent is acting.
5. **Show enforcement.** The app enforces the rules; when it blocks an agent, the activity log says so in a Rule line. Agents' allowed tools are shown wherever the agent appears.
6. **Plain words.** Six stages (Start, Plan, Spec, Build, Review, Done) and job names (writes code, reviews code) instead of internal state ids and role names. Monospace only for paths, branches, model ids and commit messages.

## 2. Color tokens

Dark theme only in v1. Every text and background pair below meets WCAG AA (4.5:1) at the sizes used.

### Surfaces

| Token | Hex | Use |
| --- | --- | --- |
| `bg/titlebar` | `#0B0D10` | Window title bar, log box |
| `bg/app` | `#0E1014` | Main content, input fields |
| `bg/rail` | `#111317` | Sidebars, icon rail, right rails, table headers |
| `bg/surface` | `#14171C` | Cards, file rows, composer |
| `bg/raised` | `#161A20` | Project switcher, search field, file chips in chat |
| `bg/chip` | `#1A1E24` | Neutral chips, selected settings-nav item |

### Borders

| Token | Hex | Use |
| --- | --- | --- |
| `border/subtle` | `#23272E` | Panel dividers, card outlines, table rows |
| `border/control` | `#2A2F37` | Buttons, inputs, selects |
| `border/strong` | `#2F3540` | Composer outline, dashed "future" cards |

### Text

| Token | Hex | Use |
| --- | --- | --- |
| `text/primary` | `#E8EAED` | Body and headings |
| `text/secondary` | `#C9CED6` | Message body, list items, secondary values |
| `text/muted` | `#A0A8B3` | Meta, labels, timestamps |
| `text/faint` | `#8B939E` | Uppercase section labels, disabled text |

### Accent (blue: the app and the agent)

| Token | Hex | Use |
| --- | --- | --- |
| `accent` | `#6EA8FE` | Primary buttons, current-item outline, progress |
| `accent/on` | `#0B1220` | Text and icons on `accent` |
| `accent/selected` | `#22324D` | Selected tab, segment or rail icon, with `#CFE0FF` text |
| `accent/soft` | `#1A2333` | User chat bubble, environment chip, with `#9CC2FF` text |
| `accent/active-card` | `#121822` or `#131B28`, border `#2B3E5E` | Active session, running agent, live round, current task |
| `link` | `#8AB8FF`, hover `#B3D0FF` | Links |

### Status

| Meaning | Strong | Text on dark | Chip bg | Panel bg / border |
| --- | --- | --- | --- | --- |
| Human gate, needs you, changed (amber) | `#F0A247` | `#F5B862` | `#3A2A12` | `#17130D` / `#5A4120`; inner `#1E1912`; muted text `#C9B48E` |
| Done, approved, online (green) | `#4CC38A` | `#6FD6A0` | `#16291F` | `#11201A` / `#2E5A44`; completed step dot `#3E7E5E` |
| Blocked, error, unreachable (red) | `#F2767A` | `#F59A9D` | `#3A1A1C` | `#1A1012` / `#5A2A2C` |

Red and green never carry meaning alone: every status also has a word ("blocked", "approved", "fixed in round 2") or an icon.

### Stages and color

| Stage (internal states) | Waiting on | Color |
| --- | --- | --- |
| Start (idle) | You: pick a source | Blue current dot |
| Plan (planning, plan-approved) | Claude, then you for each question | Blue; amber while a question waits |
| Spec (spec-drafted, spec-changed) | You: approve | Amber |
| Build (spec-approved, implementing, reviewing) | You to start, then the agents | Amber until started, then blue |
| Build paused (paused) or round limit | You: decide | Amber |
| Review (build-done) | You: approve the result | Amber |
| Done (closed) | Nobody | Green |

Done stages show a green check; future stages a grey outline with their number.

## 3. Typography

Fonts: **Inter** (400, 500, 600, 700) for UI and **JetBrains Mono** (400, 500) for code. Bundle both with the app; don't load them from Google Fonts at runtime. (The PNG renders in `design/png/` fell back to system fonts; the `.dc.html` files name the intended ones.)

| Role | Size / weight | Notes |
| --- | --- | --- |
| Page title | 20 / 600 | Settings, Projects, Build headers |
| Feature name in the Workspace header | 17 / 600 | |
| Section title | 15 / 600 | |
| Body, chat messages | 14 / 400 | Line-height 1.55 |
| Controls, list items, table cells | 13 / 400–600 | |
| Meta, captions | 12 / 400 | |
| Section label | 11 / 600 | Uppercase, letter-spacing .06em, `text/faint` |
| Badges and chips | 11 / 400–500 | |
| Activity log | 12 / 400, timestamps mono 11 | Line-height 1.6 |

Monospace is reserved for file paths, branch names, model ids, URLs, hashes, task ids and commit messages.

## 4. Spacing, sizing, radii

- **Spacing scale (px):** 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24, 28, 32. Layout uses flex or grid with `gap`, never margins between siblings.
- **Heights:** title bar 40, primary button 40, small button 32–34, chip button 26–28, input and select 38–40, two-line list item at least 44, icon-rail targets 48×48.
- **Radii:** 5–6 chips and code tags, 8 buttons, inputs and list items, 10 cards and document tabs, 12 panels, composer and Next bar, 999 pills.
- **Targets:** at least 44px wherever an action is the main thing on a row.

## 5. Layout

**Window.** Frameless Electron window with a custom 40px title bar (`-webkit-app-region: drag`; buttons inside it set `no-drag`). Windows and Linux: caption buttons on the right, 46×40 each. macOS: `titleBarStyle: 'hiddenInset'`, about 78px left padding for the traffic lights. Title bar: app mark, repo and path, branch once a build has started.

**Workspace shell:** sidebar (248–272) | main column, top to bottom: feature header with the stage stepper, documents pane, chat (content capped at 800 and centered), then the Next bar and message box pinned at the bottom.

**Other pages:** icon rail with labels (64) | content | optional right panel (380–440) for tasks and activity, or the Needs you queue. Multi-step tasks (add a server, add a project) are full-page wizards with a step row under the title and the Next bar at the bottom.

**Resizing.** Window minimum 1024×680. The documents pane can be collapsed to its tab row or dragged taller; the app remembers the height per user. Below 1024 the Workspace sidebar collapses to the icon rail. Wide tables scroll inside their own box.

## 6. Components

### Buttons

| Variant | Style | Use |
| --- | --- | --- |
| Primary | `accent` fill, `accent/on` text, 600 | One per view: New feature, Add project, Start build, Test connection |
| Gate | `#F0A247` fill, `#1A1206` text, 600 | Human-only: Approve spec, Approve and push, Update the spec, Ask for changes after the round limit |
| Secondary | Transparent, `border/control`, `text/primary` | Everything else |
| Ghost | Transparent, no border, `text/muted` | Low-weight alternatives: Not now, Not yet, Pause, Cancel |
| Danger text | Transparent, `border/control`, `#F2767A` text | Remove provider |

### Chips and badges

- **Status pill** (999 radius, 11–12px) in the status chip colors.
- **Info chip** (999 radius): environment, ticket, branch.
- **Tool chips** on agent cards: allowed tools in green ("edit source"), withheld tools in neutral with "no" ("no git").

### Lists

- **Feature item** (Workspace sidebar): two lines, feature name with a status word right-aligned ("needs you", "building", "shipped"), then the next step. Active item: `accent/soft` background, `#2B3E5E` border.
- **History item:** one line, name left, "shipped · date" or "chat · date" right.
- **Provider card:** name, endpoint URL in mono for self-hosted, status chip, model count.

### Cards

- **Project card:** name and environment chip, path in mono, a six-segment stage bar, the state in words and its one action button (amber for decisions). Border and background follow the status color when something needs attention.
- **Agent card:** job name and state chip, model and provider, tool chips.
- **Round card:** two step rows with status dots; the live round has a blue outline; future rounds are dashed.

### Chat blocks

- **User message:** right-aligned bubble, `accent/soft`, radius 12/12/4/12, with "You · time" above.
- **Click receipt:** right-aligned pill with a check ("Approved the spec", "Picked PROJ-482"). Amber for human-only actions, green for approvals of plans and marking done, blue otherwise. Receipts replace showing commands.
- **Assistant message:** left, 30px avatar tile, "Claude · time" above, body in a `bg/surface` card with radius 4/12/12/12. A "writing…" pill while it streams. Copy button and cost under the card.
- **Progress steps** at the top of a reply: check or spinner rows ("Wrote the spec", "Drafted the child ticket").
- **Question card:** blue-outlined fieldset, one question, radio choices with a one-line consequence each, the recommended one marked, "Question n of m".
- **Pickers** inside replies, such as the ticket picker: search field plus radio rows, with one confirm button.
- **Event line:** centered text between two rules, with an icon ("Spec locked · code changes are now allowed").
- **Build card:** rounds as three small cards (done, live with a blue outline, dashed future), a progress bar and a link to the build view.

### Stage stepper

A row of six numbered dots with labels and a one-line status under each ("waiting on you", "in progress"), joined by short lines that turn green as stages finish. The current dot is blue, or amber when the stage waits on the user. It sits under the feature name; the Build view repeats it, and project cards show a six-segment mini bar.

### Documents pane

A "Documents" label with Collapse, a row of tabs, then a preview. Each tab shows the name and a status line with an icon: check (done), amber dot (needs you), spinner (being written or worked on), lock (approved and locked), grey dot (draft), dashed outline (not created yet, with what it will be). The preview has a header (title, path, Open full, context actions like Compare with plan or View diff), a scrolling body around 210px tall, and a side column of facts (status, version, progress). The pane switches to the document that matters at each stage: Story while reading, Spec at approval, Tasks during the build, Report at the end. New or changed lines are highlighted.

In v1 the Ticket tab holds the child ticket as a draft ("draft · copy to Jira") with a Copy action; creating it in the tracker comes in v1.1 (PRD D8).

### Next bar

A rounded bar directly above the message box (or at the bottom of Build and wizard pages): icon tile, a small "Next" label, the action as a sentence, an optional one-line explanation, and up to three buttons (primary first). Four styles: amber (human-only decision), blue (normal next step), blue with a spinner (agents working; offers Pause or See every step), green (finished). It never disappears; when there is nothing to do it offers the next feature.

### Choice cards and wizards

Decisions with consequences (spec problem, round limit) use large radio cards with a title and a two-line explanation, the recommended one outlined in blue, mirrored by the Next bar buttons. Wizards show steps as pills (done green, current blue, future dashed).

### Tasks panel

A to-do list of the feature's tasks (from `tasks.md`), at the top of the Build view's side panel; the Tasks tab in the Workspace documents pane uses the same rows. Header: "Tasks", "n of m done", an All / Open switch, and a green progress bar.

| Row state | Treatment |
| --- | --- |
| Done | Green filled circle with a check; title struck through in `text/faint`; the round it finished in |
| Now | Card with `accent/active-card` fill and blue border, spinner in the circle, bold title, "Now" chip, and a line saying who is on it and what they are doing |
| Paused | Same card in the amber panel colors, pause icon, "Paused" chip and the reason |
| Issue left | Amber card, "1 issue left" chip, the measured value against the limit |
| Proposed | Dashed blue border and circle, "proposed" chip; added only if the user approves the spec change |
| To do | Empty grey ring; the next one says "up next" |

Each row shows its id (T1, T2) in mono. A task ticks off when the reviewer confirms it, not when the writer finishes.

### Forms

Labels above fields (12px, `text/muted`). Inputs 38–40px, `bg/app` fill, `border/control`. URLs, keys and model ids in mono. Secrets in password fields, stored in the OS keychain (Electron `safeStorage`), never in project files. Toggles are `input type="checkbox" role="switch"`; rules the app requires are shown on and disabled.

### Icons

24px-grid stroke icons drawn at 12–18px, stroke 2 (2.4–3 for checks and plus). One icon set in the build (for example Lucide). No emoji. Icon-only buttons always carry `aria-label`.

## 7. Screen behaviour

### Workspace (page 1)

1. **New feature.** Three option cards (start from a ticket, I already have a spec, describe an idea), a line of readiness checks, and "Or continue" links. The documents pane shows every tab as a dashed placeholder. Typing in the message box counts as "describe an idea".
2. **Pick a ticket.** Claude shows the user's open tickets with no spec in a picker. After the pick, the Story tab fills and Claude lists the open points it will ask about. Next bar: working, with Stop.
3. **Plan, then approve the spec.** One question at a time with choices; free-text answers also work. The plan summary appears in the reply and the Plan tab; approving it is a button in the reply. The spec opens in the Spec tab with new lines highlighted. Next bar: amber Approve spec and Ask for changes.
4. **Start the build.** A receipt, the "Spec locked" event, the child ticket (a draft in the Ticket tab in v1; created in the tracker from v1.1), and a "Who does what" card with Change buttons. Next bar: Start build.
5. **Building.** A live build card in the reply; tasks tick off in the Tasks tab. The user can keep chatting; answers come from the changes and review notes. Next bar: progress with See every step and Pause.
6. **Review the result.** Four headline numbers, the Report tab with a pass row per criterion, and the commit message, editable. Next bar: amber Approve and push, Ask for changes, Not yet.
7. **Shipped.** Receipts for approve and mark as done, a shipped summary with the follow-ups, Copy ticket (v1 keeps the child ticket as a draft for the user to paste into the tracker), and Start next feature, which carries a short summary forward and drops the rest of the context.

### Build run (page 2)

- **Running.** A to-do style Tasks panel tops the side panel: a progress bar, done tasks checked and struck through, the current task in a highlighted card with a Now chip and who is working on it, then the tasks still to do. Paused or problem tasks turn amber; tasks a spec change would add appear dashed as "proposed". Below that: review rounds, agent cards with model and tool chips, issues table, files changed (checked against git), and an activity log filtered by All, Files, Tests and Rules. Rule lines are red and name what was blocked and why.
- **Paused for a spec problem.** Amber banner, the spec text and the conflicting rule side by side, three choice cards, and a suggested spec diff in the side panel. Updating the spec reopens approval; the build resumes from the paused round.
- **Round limit reached.** All rounds shown, the open issue with measured value and limit, and three choices: Ask for changes (one extra round, counted separately), Approve as it is (issue goes in the report and a follow-up is drafted), Not yet.

### Models and agents (page 3)

- **Overview.** Provider cards (status, URL for self-hosted, model count), an "Add a self-hosted server" card, the "Who does what" table with backups and warnings, and the read-only "What each agent can do" table. Projects can remove tools, never add.
- **Add a server.** Preset cards fill the address format: vLLM, Ollama (OpenAI-compatible, `:11434/v1`), LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway, and Other (any OpenAI- or Anthropic-format URL). Then name, address, optional key and headers, and a "private server" checkbox for self-hosted-only projects.
- **Test and assign.** Three tests per model (chat, use tools, edit a file and run tests), context and speed, a "good for" label, then job checkboxes. Jobs a model can't do are disabled with the reason.

### Projects (page 4)

- **Projects.** Cards with environment, path, a six-segment stage bar, the state in words and its one action (amber for decisions). A right panel collects Needs you items from all projects, then Running and Shipped this week.
- **Add project: where.** Four environment cards; detected details (WSL distributions, saved servers, Docker running or not). Unavailable options stay visible but disabled with the fix.
- **Add project: checks and rules.** Checks run on their own (git, code host, tracker, test command, earlier specs). Rules: spec approval and review are locked on; round limit, model policy and commit message format are editable.

## 8. Rules the app enforces (and the UI must show)

1. **Human-only actions** (approve spec, approve result, change an approved spec, decide after the round limit, mark as done, change project rules) exist only as buttons the app accepts from a click in its own window. No agent tool can trigger them.
2. **Tools per job.** Each agent gets only its job's tools (see the table on the Models and agents page). The app checks every call before it runs; a blocked call becomes a Rule line in the activity log.
3. **Spec lock.** After approval the spec is read-only to every agent; the lock is shown on the Spec tab and in the header ("Code changes allowed").
4. **Order.** Approve the result, then commit and push (done by the app, never an agent), then mark as done. Buttons appear only in that order.
5. **Round limit.** After the project's limit (3 by default) the app stops and asks the user.
6. **Every waiting state has a Next bar** naming the action in words, recommended option first.

## 9. States not drawn

| State | Treatment |
| --- | --- |
| Hover | Buttons lighten about 6%, or gain `bg/chip` behind transparent ones; list rows get `bg/raised` |
| Focus | 2px `accent` outline, 2px offset, on every focusable element |
| Pressed | Fill darkens about 6% |
| Loading | Skeleton bars in `bg/chip`; spinners only inside buttons and status lines; "writing…" pill while replies stream |
| No projects | Centered card with Add project and a line on environments |
| No providers | Banner on every screen linking to Models and agents until one model connects |
| Provider offline | Agent card and model button turn red; the app switches to the backup model and says so in the activity log |
| Agent blocked by a rule | Red Rule line in the activity log; nothing shown in the chat unless the agent can't continue |
| Environment unreachable | Project card turns red with Reconnect; sessions open read-only |
| Documents pane collapsed | Tab row only, statuses still visible; an amber tab still pulses once when it needs the user |

## 10. Accessibility

- Real `button`, `a`, `input`, `select`, `label` and `table` elements, as drawn.
- All text pairs in section 2 pass 4.5:1; status is never color alone.
- Keyboard: full tab order; Ctrl/Cmd+K action menu, Ctrl/Cmd+P project switch, Ctrl/Cmd+N new feature, Esc closes popovers.
- Activity log and streaming chat use `aria-live="polite"`; the Next bar takes focus when it changes to a human-only action.
- `prefers-reduced-motion` turns off spinners' rotation and the tab pulse.

## 11. Open questions

Settled: dark only in v1; no typed commands, buttons only (PRD D10, D11).

- [ ] Documents pane default height on small screens: collapsed or 210px?
- [ ] Notifications outside the app (OS notifications, email) when a project needs the user?
