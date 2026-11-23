# thousands Strategy

## Vision

<!-- vision: author-approved 2026-11-22 -->

`thousands` exists so that a Strength of Thousands group can run the campaign's unique subsystems inside Foundry VTT with character-sheet-backed state and PF2e-native rolls.
It serves GMs and players running Strength of Thousands on the current Foundry VTT and PF2e releases, turning downtime checks, level-ups, rests, and campus standings into PF2e bonus feats, roll modifiers, sheet summaries, and GM-controlled outcomes.
It owns exactly one thing: Foundry VTT rules automation and sheet-backed campaign state for Strength of Thousands-specific subsystems.

### Sheet-Backed State and Native Workflows

Canonical campaign state lives on the PF2e character sheet as bonus feats, rule elements, and minimal actor flags rather than inside a separate module database.
Every check routes through native PF2e rolls with the expected traits and roll options so existing modifiers, Hero Points, and rerolls keep working without special cases.
The module exposes workflows through slash commands, macro APIs, compact dialogs, chat cards, embedded character-sheet panels, and GM overview windows that read and drive that sheet-backed state.
PF2e rule elements automate mechanics wherever the system supports them, and guided prompts or hooks close remaining manual setup steps when rule elements alone fall short.
UI stays anchored to mechanical sheet state rather than growing into a narrative campaign planner, semester timeline, or session-note journal.

### GM Authority and Configurable Defaults

GM confirmation via an explicit Apply chat card is the default for every state mutation, keeping the GM in control of table rulings and pacing.
Opt-in automation that skips manual prompts or Apply clicks is acceptable only behind GM world settings that default to off and keep outcomes reversible.
Applying an outcome is idempotent and reroll-safe, so repeating an action does nothing and a Hero Point or fortune reroll cleanly replaces the prior result.
Official variant rules, table-interpretation toggles, and lightweight world-level overrides that stay close to existing functionality belong in GM world settings defaulting to the printed rules.

### Pure Rules Core and Verifiable Boundaries

Campaign rules math lives in a pure, storage-agnostic TypeScript core with zero references to Foundry or PF2e globals, enforced by linting and tested in bare Node.
Foundry integration, including sheet panels, overview windows, and guided hooks, stays behind thin mockable adapters so workflows can be exercised end to end without a running VTT server.
Every referenced PF2e compendium UUID, slug, schema version, action, and trait is verified automatically in CI against the pinned PF2e system data release rather than trusted by hand.
Integrations with third-party Foundry modules are welcome only when strictly optional with zero hard dependencies and covered by automated tests.

### Current-Platform Focus and Localization

The module targets the current Foundry VTT 14 and PF2e 8.7+ major release directly and refuses multi-major compatibility shims for older releases.
Bugs rooted in platform behavior are fixed against current Foundry and PF2e contracts rather than worked around with legacy layers.
User-facing text belongs in localization files so community translations can be supported and verified in CI.

### Paizo Community Use Hygiene

Compendium entries carry concise paraphrased mechanics and page citations rather than copied adventure prose, stat blocks, or artwork.
Uncommon spells, items, feats, and class features are linked from the PF2e system compendiums rather than duplicated in this module.
Code stays MIT-licensed and non-commercial under Paizo's Community Use Policy.

### Scope

`thousands` supports Strength of Thousands-specific subsystems across the campaign, including extending campus relationship tracking to other world NPCs.
Standard Pathfinder 2e subsystems such as Influence belong in the core PF2e system by default and are included here only when there is a concrete campaign-specific reason.
`thousands` is not a paid adventure importer, not a narrative campaign planner or journal suite, not a backwards-compatible multi-version Foundry library, and not a heavy custom campaign builder that diverges far from the printed subsystem structure.
It does not ship adventure maps, tokens, NPC stat blocks, verbatim text from Paizo publications, or GM adventure-prep scaffolding such as NPC stubs or chapter checklists.

A change aligns when it automates a Strength of Thousands-specific subsystem, official variant, sheet view, GM overview, localization, or close-fit world override on top of pure rules, sheet-backed state, and mock-testable adapters verified against pinned PF2e data.
A change should be resisted when it reimplements a standard PF2e subsystem without a clear campaign-specific reason, mutates state automatically by default without GM Apply, introduces a narrative prep workspace or adventure scaffolding, carries multi-major Foundry shims, adds untestable or hard third-party dependencies, duplicates PF2e compendium content or adventure prose, or leaks Foundry globals into the rules engine.
