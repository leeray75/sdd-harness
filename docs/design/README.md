# Design files

16 screens across four pages. Each screen has two files:

- `screens/<Name>.dc.html`: the source. Plain HTML with inline styles: exact colors, sizes, spacing and copy. The `<x-dc>`, `<helmet>` and `support.js` wrapper comes from the design tool and is not part of the product; ignore it.
- `png/<Name>.png`: a render at 1440px wide (system fonts stood in for Inter and JetBrains Mono).

Read [`../design-notes.md`](../design-notes.md) for the tokens, components, behaviour and states the screens don't show.

| Page | Screen | File |
| --- | --- | --- |
| 1 · Workspace | New feature (first screen) | `Flow0Empty` |
| 1 · Workspace | Pick a ticket, Claude reads it | `Flow1Start` |
| 1 · Workspace | Plan with Claude, then approve the spec | `Main` |
| 1 · Workspace | Spec approved: start the build | `Flow3Approved` |
| 1 · Workspace | Building: live progress | `Flow4Building` |
| 1 · Workspace | Review the result | `Flow5Done` |
| 1 · Workspace | Shipped | `Flow6Closed` |
| 2 · Build run | Build running (Tasks panel, rounds, agents, activity) | `Build` |
| 2 · Build run | Paused: problem in the spec | `Build2Paused` |
| 2 · Build run | Round limit reached | `Build3Limit` |
| 3 · Models and agents | Overview, who does what, tool permissions | `Providers` |
| 3 · Models and agents | Add a self-hosted server | `Models2Add` |
| 3 · Models and agents | Test and assign | `Models3Test` |
| 4 · Projects | Projects and Needs you | `Projects` |
| 4 · Projects | Add project: where | `Projects2Env` |
| 4 · Projects | Add project: checks and rules | `Projects3Setup` |

Sample data in the screens (PROJ-482, logout-button, model names, timings, costs) is illustrative.
