# Official source map

Use this map before relying on an early-access Mod detail. It explains what
each official source is good for. Full URLs live in `reading.md`.

| Question | Read first | Why |
|---|---|---|
| What is a Claude Mod? Is it shipping? How do I enable it? | The tracking issue #91870 | It defines the product name, says that Mods are plugins using function hooks, and publishes the early-access flag. |
| Which event or `$` call exists on this installed version? | `/plugin-types`, then the local generated type file | It is generated for the binary that will execute the Mod. |
| Will this source shape be admitted and what footprint will it declare? | `claude plugin validate` | The validator is the executable admission and footprint check. |
| What does an event or `$` capability mean at a glance? | The official cheat sheet | It explains the event model, side effects, recursion and the capability surface. |
| Why do `next`, tiers, middleware and `$` composition work this way? | The Core Architecture paper | It explains the execution model, ordering and control boundaries. |
| What does Anthropic itself ship and test? | Built-in Mods and the test kit | They are concrete official examples and the supported mock/testing shape. |
| How should plugin metadata, installation and marketplace behaviour work? | Claude Code plugin reference | It is the general plugin contract around the Mod. |

## Conflict rule

The current binary wins over every document. A validator result wins over a
template. The current upstream type declarations beat the cheat sheet and the
architecture paper. The cheat sheet and paper explain intent but can lag the
implementation. Built-in Mods are examples, not an API contract. Community
Mods and the awesome catalogue are discovery evidence only.

## Required research by task

| Task | Minimum official evidence before acting |
|---|---|
| Explain | Tracking issue; use the cheat sheet only for a capability question. |
| Build or migrate | Generated types for the target binary; validator after code. |
| Debug | Validator error and generated types before changing source. |
| Review | Validator output, generated types for disputed shapes, then README. |
| Publish | Validator output, test result, plugin reference and the Mod's README. |

Do not claim an API is absent because an older cheat sheet does not list it.
Do not claim an API exists because a community Mod uses it. Check the current
type file and validator instead.
