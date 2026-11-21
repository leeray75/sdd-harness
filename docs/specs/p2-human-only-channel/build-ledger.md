# Build ledger: p2-human-only-channel
state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a37d8a55f17eecbb6, haiku    Reviewer: a7ed0a36fe7aeb436, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Revision 0 (implementation only; paused before review round 1)
The implementor completed T1–T8 and reported NEEDS-SPEC-CHANGE on AC6 (see Spec problems). No review ran in revision 0.

## Revision 1, round 1  (PASS)
The reviewer checked AC1–AC9 against the diff and `changes.md` (23 rows, all matching git). It read the AC5–AC7 tests only through `changes.md` and the implementation report.

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1: a throwing handler writes two log lines (`handler threw (<name>)`, then the decision line), where AC3 says one line per call | minor (optional) | src/main/human/channel.ts:121 | not sent (PASS ends the loop) | The reviewer marked it optional: AC3 also asks that the error be logged | none; left for the user to decide |

## Spec problems
- Revision 0 pause (from the implementation report, before review round 1): AC6 said each refused call "is logged as a deny Rule event naming the job, the tool and the reason". For `approve_spec` and `git_push`, which are not registry tools, `makeRuleEvent` (src/main/policy/rule-event.ts) records the tool as `-` (D30). Candidates: (1) keep `-` and amend AC6; (2) record a sanitized requested name; (3) add a separate refusal line. User chose: Revise the spec; decision: keep `-` (candidate 1). AC6 amended, the decision recorded under Open questions as revision 1, T5 unticked, then re-approved. On resume (Mode 3), the implementor confirmed the test, added assertions for no extra log line, and ticked T5.

## Carried findings
none
