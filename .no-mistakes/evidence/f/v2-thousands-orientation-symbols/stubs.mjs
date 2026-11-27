// Minimal stand-ins for the proprietary Foundry host globals so the real PF2e 8.7.0 bundle can load.
const make = () => {
  const cache = new Map();
  return new Proxy(class Stub {}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === Symbol.toPrimitive) return () => "";
      if (typeof p === "symbol" || p === "then") return undefined;
      if (!cache.has(p)) cache.set(p, make());
      return cache.get(p);
    },
    apply: () => make(),
  });
};
class DataModel {
  static defineSchema() { return {}; }
  constructor(data = {}, opts = {}) {
    const { predicate, ...rest } = data;
    Object.assign(this, structuredClone(rest));
    if (predicate) this.predicate = predicate;
    Object.defineProperty(this, "parent", { value: opts.parent, writable: true });
    this.invalid = false; this.validationFailures = {};
  }
}
const foundry = make();
const real = {
  abstract: { DataModel },
  utils: {
    deepClone: (v) => structuredClone(Array.isArray(v) ? [...v] : v),
    getProperty: (o, k) => k.split(".").reduce((a, b) => a?.[b], o),
  },
};
globalThis.foundry = new Proxy(foundry, { get: (t, p) => p === "abstract" ? new Proxy(t.abstract, { get: (a, q) => q === "DataModel" ? DataModel : a[q] })
  : p === "utils" ? new Proxy(t.utils, { get: (a, q) => real.utils[q] ?? a[q] }) : t[p] });
for (const n of ["CONFIG","CONST","game","ui","canvas","Hooks","document","window","Roll","Actor","Item","ChatMessage","Combat","Combatant","Scene","TokenDocument","ActiveEffect","Macro","RollTable","JournalEntry","JournalEntryPage","User","Folder","CombatTracker","ActorDirectory","ItemDirectory","ChatLog","Token","MeasuredTemplate","TextEditor","Handlebars","PIXI","FormApplication","Application","Dialog","DocumentSheet","ActorSheet","ItemSheet","jQuery","$","CompendiumDirectory","Ruler","loadTemplates","renderTemplate","fromUuid","fromUuidSync","AmbientLight","Wall","Tile","Drawing","Note","MeasuredTemplateDocument","HTMLElement","customElements","Math2","BasePlaceableHUD","TokenHUD","Localization","Cards","Playlist","ChatBubbles","Compendium","SettingsConfig","CONFIGURE"])
  if (!(n in globalThis)) globalThis[n] = make();
globalThis._loc = (s) => s;
Math.clamp ??= (v, a, b) => Math.min(Math.max(v, a), b);
RegExp.escape ??= (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export { make };
Array.fromRange ??= (n, min = 0) => Array.from({ length: n }, (_, i) => i + min);
Array.prototype.findSplice ??= function (f, r) { const i = this.findIndex(f); if (i < 0) return null; const x = this[i]; r === undefined ? this.splice(i, 1) : this.splice(i, 1, r); return x; };
Number.isNumeric ??= (n) => !isNaN(parseFloat(n)) && isFinite(n);
Number.between ??= (n, a, b) => n >= a && n <= b;
