// Drives the BUILT compendium item through the real PF2e 8.7.0 rule-element code. Foundry host globals are stand-ins.
import "./stubs.mjs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const [, , worktree, packDir, spellsJson] = process.argv;
const { ClassicLevel } = createRequire(worktree + "/package.json")("classic-level");
const { make } = await import("./stubs.mjs");
for (const n of ["RegionBehavior", "RegionDocument", "WallDocument", "Collection", "MutationObserver"]) globalThis[n] ??= make();
const pf = await import("../sys/pf2e-exp.mjs");
globalThis.game = { pf2e: { variantRules: { AutomaticBonusProgression: { suppressRuleElement: () => false } } } };
globalThis.ui = { notifications: { warn: console.warn, info: () => {} } };

const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json" });
const all = await db.sublevel("items", { keyEncoding: "utf8", valueEncoding: "json" }).values().all();
await db.close();
const feat = all.find((f) => f.name === "Orientation Symbol");
console.log(`built pack: ${all.length} items; "${feat.name}" level ${feat.system.level.value} category ${feat.system.category}`);
console.log("description:", feat.system.description.value);
console.log("rules:", JSON.stringify(feat.system.rules, null, 1));

let failures = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${label}: got ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`); };

function world(level, source) {
  const actor = { id: "a1", type: "character", name: "Student", level, flags: { pf2e: {} }, synthetics: { modifiers: {} },
    rollOptions: { all: { [`self:level:${level}`]: true } }, isOfType: (...t) => t.includes("character"),
    getRollOptions() { return Object.keys(this.rollOptions.all); } };
  const item = { name: source.name, slug: source.system.slug, uuid: "Actor.a1.Item.f1", actor, system: structuredClone(source.system),
    flags: { pf2e: { rulesSelections: {} } }, specialOptions: [], rules: [], isOfType: (...t) => t.includes("feat"), getRollOptions: () => [] };
  return { actor, item };
}
const make_ = (Cls, src, item) => new Cls({ ignored: false, priority: 100, ...src, predicate: new pf.__Predicate(...(src.predicate ?? [])) }, { parent: item });

/** Player adds the feat and picks `value`: runs the real ChoiceSet preCreate. */
async function pick(value) {
  const { actor, item } = world(1, feat);
  const ruleSource = { ...structuredClone(feat.system.rules[0]), selection: value };
  const cs = make_(pf.__ChoiceSet, ruleSource, item); item.rules.push(cs);
  const itemSource = structuredClone(feat);
  await cs.preCreate({ itemSource, ruleSource, tempItems: [] });
  itemSource.system.rules[0] = ruleSource;
  return { saved: itemSource, offered: cs.choices };
}
/** Data prep for the saved item at `level`, then a save with the given extra roll options. */
function save(saved, level, extra, others = []) {
  const { actor, item } = world(level, saved);
  const [csSrc, fmSrc] = saved.system.rules;
  item.rules.push(make_(pf.__ChoiceSet, csSrc, item));
  const fm = make_(pf.__FlatModifier, fmSrc, item); item.rules.push(fm); fm.beforePrepareData();
  const options = [...actor.getRollOptions(), ...extra];
  const mods = (actor.synthetics.modifiers["saving-throw"] ?? []).map((f) => f({ test: options })).filter(Boolean);
  const stat = new pf.__Statistic("will", [...mods, ...others.map((o) => new pf.__Modifier(o))], options);
  return { total: stat.totalModifier, enabled: stat.modifiers.filter((m) => m.enabled).map((m) => m.label), opts: actor.getRollOptions() };
}

console.log("\n== S1 picking each choice (real ChoiceSet.preCreate)");
const choices = feat.system.rules[0].choices;
const saved = {};
for (const c of choices) {
  const r = await pick(c.value); saved[c.value] = r.saved;
  console.log(`  pick ${c.value} -> item name "${r.saved.name}"`);
  check(`name carries choice label (${c.value})`, r.saved.name, `Orientation Symbol (${c.label})`);
  check(`roll option set (${c.value})`, save(r.saved, 1, []).opts.includes(`orientation-symbol:${c.value}`), true);
}
check("seven choices offered", choices.length, 7);
const spell = ["item:type:spell"];
console.log("\n== S2 No Symbol, level 1, save against a spell");
check("bonus", save(saved.none, 1, spell).total, 1);
console.log("\n== S3 No Symbol, level boundary (same saved item re-prepared)");
for (const l of [1, 2, 3, 10, 20]) check(`level ${l} vs spell`, save(saved.none, l, spell).total, l === 1 ? 1 : 0);
console.log("\n== S4 No Symbol, level 1, non-spell saves");
for (const extra of [[], ["item:type:weapon"], ["item:type:feat", "item:trait:magical"], ["item:type:effect"]]) check(`options ${JSON.stringify(extra)}`, save(saved.none, 1, extra).total, 0);
console.log("\n== S5 each symbol gets no save bonus");
for (const c of choices.filter((c) => c.value !== "none")) for (const l of [1, 2]) check(`${c.value} level ${l} vs spell`, save(saved[c.value], l, spell).total, 0);
console.log("\n== S6 status stacking");
check("with another +1 status", save(saved.none, 1, spell, [{ slug: "other", label: "Other status", modifier: 1, type: "status" }]).total, 1);
check("with +2 status", save(saved.none, 1, spell, [{ slug: "other", label: "Other status", modifier: 2, type: "status" }]).total, 2);
check("with +1 circumstance", save(saved.none, 1, spell, [{ slug: "other", label: "Circ", modifier: 1, type: "circumstance" }]).total, 2);

console.log("\n== S7 cantrip names/traditions in choice labels vs PF2e 8.7.0 spells pack");
const spells = JSON.parse(readFileSync(spellsJson, "utf8"));
for (const c of choices.filter((c) => c.value !== "none")) {
  const [, name, trad] = /\((.+), (\w+)\)$/.exec(c.label);
  const s = spells.find((s) => s.name === name && s.system.traits.value.includes("cantrip"));
  check(`${c.label} exists as ${trad} cantrip`, !!s?.system.traits.traditions.includes(trad), true);
}
check("no Note/GrantItem rules", feat.system.rules.map((r) => r.key), ["ChoiceSet", "FlatModifier"]);
console.log(`\nfailures: ${failures}`);
process.exit(failures ? 1 : 0);
