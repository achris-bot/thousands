// Local stand-in for the Foundry VTT + PF2e host. The module under test is the real built dist/module.js.
// Contracts transcribed from: DialogV2RenderCallback(event, dialog); button callback(event, button);
// foundryvtt/pf2e v14-dev actor/base.ts increaseCondition/decreaseCondition; Statistic#roll({modifiers}).
(() => {
  const hooks = {};
  window.Hooks = {
    on: (n, f) => (hooks[n] ??= []).push(f),
    once: (n, f) => (hooks[n] ??= []).push(f),
    call: (n, ...a) => { for (const f of hooks[n] ?? []) if (f(...a) === false) return false; return true; },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);
  let ids = 0;
  const settings = new Map();
  const mod = {};
  window.warnings = [];
  window.game = {
    user: { id: "gm", isGM: true },
    actors: [],
    settings: { register: (s, k, c) => settings.set(k, c.default), get: (_s, k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    modules: { get: () => mod },
    pf2e: { Modifier: class { constructor(d) { Object.assign(this, d); } } },
  };
  window.canvas = { tokens: { controlled: [] } };
  window.ui = { notifications: { warn: (t) => { warnings.push(t); const d = document.createElement("div"); d.className = "toast"; d.textContent = "⚠ " + t; document.querySelector("#toasts").append(d); } } };
  window.messages = [];
  const render = (m) => {
    const li = document.createElement("li");
    li.dataset.id = m.id;
    li.innerHTML = `<header>${esc(m.actor?.name ?? "")}</header><div class="message-content">${m.content}</div>`;
    const old = document.querySelector(`li[data-id="${m.id}"]`);
    old ? old.replaceWith(li) : document.querySelector("#log").append(li);
    Hooks.call("renderChatMessageHTML", m, li);
    document.querySelector("#log").scrollTop = 1e9;
  };
  window.render = render;
  window.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor?.id }),
    create: async (data) => {
      const m = { id: "m" + ++ids, content: data.content, flags: structuredClone(data.flags ?? {}), actor: game.actors.find((a) => a.id === data.speaker?.actor) };
      m.update = async (changes) => {
        for (const [path, v] of Object.entries(changes)) { const k = path.split("."); let o = m; while (k.length > 1) o = o[k.shift()] ??= {}; o[k[0]] = v; }
        render(m);
      };
      messages.push(m); render(m); return m;
    },
  };
  window.foundry = {
    utils: { randomID: () => "id" + ++ids + Math.random().toString(36).slice(2, 8), escapeHTML: esc },
    applications: { api: { DialogV2: { wait: (config) => new Promise((resolve) => {
      const element = document.createElement("dialog");
      element.innerHTML = `<form onsubmit="return false"><h3>${esc(config.window.title)}</h3><div class="content">${config.content}</div><footer></footer></form>`;
      for (const b of config.buttons) {
        const el = document.createElement("button");
        el.type = "button"; el.textContent = b.label; el.disabled = !!b.disabled; el.dataset.action = b.action;
        el.addEventListener("click", (ev) => { const out = b.callback(ev, el); element.remove(); resolve(out); });
        element.querySelector("footer").append(el);
      }
      const close = document.createElement("button");
      close.type = "button"; close.textContent = "Cancel"; close.dataset.action = "close";
      close.addEventListener("click", () => { element.remove(); resolve(null); });
      element.querySelector("footer").append(close);
      document.body.append(element); element.show();
      config.render?.(new Event("render"), { element });
    }) } } },
  };

  // ---- Characters ----
  window.d20 = [];
  const degreeOf = (die, total, dc) => {
    let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (die === 20) d = Math.min(3, d + 1);
    if (die === 1) d = Math.max(0, d - 1);
    return ["criticalFailure", "failure", "success", "criticalSuccess"][d];
  };
  window.rolls = [];
  async function postRoll(actor, slug, args, die) {
    const extra = (args.modifiers ?? []).reduce((n, m) => n + m.modifier, 0);
    const total = die + 10 + extra;
    const outcome = degreeOf(die, total, args.dc);
    rolls.push({ actor: actor.name, slug, dc: args.dc, modifiers: (args.modifiers ?? []).map((m) => ({ ...m })), options: args.extraRollOptions, die, total, outcome });
    const mods = (args.modifiers ?? []).map((m) => ` <em>[${esc(m.label)} ${m.modifier} ${m.type}]</em>`).join("");
    const message = await ChatMessage.create({
      speaker: { actor: actor.id },
      content: `<p><strong>${esc(args.label)}</strong><br>d20 ${die} + 10${mods} = ${total} vs DC ${args.dc}: <b>${outcome}</b></p>`,
      flags: { pf2e: { context: { options: [...args.extraRollOptions], outcome } } },
    });
    message.rollArgs = { slug, args };
    return outcome;
  }
  /** PF2e hero point reroll: the old message is replaced by one with the same options and modifiers. */
  window.reroll = async (id, die) => {
    const i = messages.findIndex((m) => m.id === id);
    const old = messages[i];
    messages.splice(i, 1); document.querySelector(`li[data-id="${id}"]`).remove();
    await postRoll(old.actor, old.rollArgs.slug, old.rollArgs.args, die);
  };
  window.makeActor = (feats, spec) => {
    const options = [`academia:branch:primary:${spec.primary[0]}`, `academia:branch:secondary:${spec.secondary[0]}`, `academia:rank:${spec.rank ?? "conversant"}`];
    for (const [id, n] of [spec.primary, spec.secondary]) for (let l = 1; l <= n; l++) options.push(`academia:branch:${id}:level:${l}`);
    const itemFor = (source) => ({ id: "i" + ++ids, system: { slug: source.system.slug }, name: source.name });
    const flags = {};
    const a = {
      id: "a" + ++ids, name: spec.name, level: spec.level, type: "character", conditions: {}, conditionCalls: [],
      items: options.map((o) => { const f = feats.find((f) => f.system.rules.some((r) => r.option === o)); if (!f) throw new Error("no feat " + o); return itemFor(f); }),
      flags,
      getFlag: (s, k) => structuredClone(flags[s + "." + k]),
      setFlag: async (s, k, v) => { flags[s + "." + k] = structuredClone(v); },
      createEmbeddedDocuments: async (_t, sources) => { a.items.push(...sources.map(itemFor)); },
      deleteEmbeddedDocuments: async (_t, del) => { a.items = a.items.filter((i) => !del.includes(i.id)); },
      getCondition: (slug) => (a.conditions[slug] ? { slug, value: a.conditions[slug] } : null),
      increaseCondition: async (slug, { max = Number.MAX_SAFE_INTEGER, value } = {}) => {
        a.conditionCalls.push(["increase", slug, { value, max }]);
        const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
        a.conditions[slug] = a.conditions[slug] ? clamp(a.conditions[slug] + (value ?? 1), 1, max) : clamp(1, value ?? 1, max);
      },
      decreaseCondition: async (slug) => {
        a.conditionCalls.push(["decrease", slug]);
        if (a.conditions[slug]) a.conditions[slug] -= 1;
        if (!a.conditions[slug]) delete a.conditions[slug];
      },
    };
    const skills = ["acrobatics","arcana","athletics","crafting","deception","diplomacy","intimidation","medicine","nature","occultism","performance","religion","society","stealth","survival","thievery","academia-lore","warfare-lore"];
    a.skills = Object.fromEntries(skills.map((slug) => [slug, {
      slug, label: slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "), lore: slug.endsWith("-lore"),
      roll: async (args) => { const outcome = await postRoll(a, slug, args, d20.shift() ?? 10); await args.callback?.(null, outcome); },
    }]));
    return a;
  };
})();
