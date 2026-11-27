import { createRequire } from "node:module";
import { readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { resolve, extname } from "node:path";
const root = process.argv[2], ev = process.argv[3];
const require = createRequire(resolve(root, ".tmp-qa/pw/x.js"));
const { chromium } = require("playwright-core");
const { ClassicLevel } = createRequire(resolve(root, "x.js"))("classic-level");
// read the actually-built compendium pack (copy so dist stays untouched)
const copy = resolve(root, ".tmp-qa/packcopy"); rmSync(copy, { recursive: true, force: true }); cpSync(resolve(root, "dist/packs/academia-feats"), copy, { recursive: true });
const db = new ClassicLevel(copy, { valueEncoding: "json" });
const pack = [], keys = [];
for await (const [k, v] of db.iterator()) { keys.push(k); pack.push(v); }
await db.close();
const out = []; const log = (...a) => { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); out.push(s); console.log(s); };
let failed = 0; const check = (name, cond, detail) => { if (!cond) failed++; log(`${cond ? "PASS" : "FAIL"} ${name}`, detail ?? ""); };

const browser = await chromium.launch({ executablePath: "~/.local/bin/chromium" });
const errors = [];
async function open(gm = true) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => m.type() === "error" && errors.push(m.text()));
  await page.route("http://foundry.local/**", r => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/pack.json") return r.fulfill({ contentType: "application/json", body: JSON.stringify(pack) });
    if (p === "/") return r.fulfill({ contentType: "text/html", body: readFileSync(resolve(root, ".tmp-qa/harness.html")) });
    if (p.startsWith("/dist/")) return r.fulfill({ contentType: extname(p) === ".css" ? "text/css" : "text/javascript", body: readFileSync(resolve(root, "." + p)) });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto(`http://foundry.local/?gm=${gm ? 1 : 0}`); await page.waitForFunction(() => window.ready);
  return page;
}
const shot = (page, f) => page.screenshot({ path: resolve(ev, f), fullPage: true });
const chat = async (page, t) => { await page.fill("#input", t); await page.press("#input", "Enter"); };
const dlg = (page) => page.evaluate(() => { const d = document.querySelector("dialog"); if (!d) return null;
  const s = (n) => { const e = d.querySelector(`select[name="${n}"]`); return e ? { selected: e.selectedOptions[0].textContent, options: [...e.options].map(o => o.textContent) } : null; };
  return { target: s("target"), rank: s("rank"), who: d.querySelector(".thousands-character")?.textContent ?? null }; });
const cards = (page) => page.$$eval(".msg", ms => ms.map(m => ({ speaker: m.querySelector("header").textContent, card: m.querySelector(".thousands-promote p")?.textContent, apply: !!m.querySelector(".thousands-promote button") })));
const ranks = (page) => page.evaluate(() => Object.fromEntries(["nia","tarek","sera","pregen"].map(i => [i, rankFeats(i).join(",")])));
const apply = async (page, i) => { await page.click(`.msg[data-i="${i}"] .thousands-promote button`); await page.waitForFunction(i => !document.querySelector(`.msg[data-i="${i}"] .thousands-promote button`), i); };
async function post(page, { target, rank }) {
  if (target !== undefined) await page.selectOption('dialog select[name="target"]', { label: target });
  if (rank) await page.selectOption('dialog select[name="rank"]', rank);
  const before = await page.evaluate(() => messages.length);
  await page.click('dialog button[data-action="promote"]'); await page.waitForFunction(b => messages.length > b, before);
}

log("== S1 GM /promote single character ==");
let p = await open();
await chat(p, "/promote"); await p.waitForSelector("dialog");
let d = await dlg(p); log("dialog", d);
check("targets list world characters + party, no NPC", d.target.options.length === 5 && !d.target.options.join().includes("Pugwampi") && d.target.options.at(-1) === "Whole party (3 members)", d.target.options);
check("Initiate not offered; default Attendant", d.rank.options.join() === "Attendant,Conversant,Lore-Speaker" && d.rank.selected === "Attendant", d.rank);
await p.selectOption('dialog select[name="target"]', { label: "Tarek (Conversant)" });
check("changing target to Conversant updates default to Lore-Speaker", (await dlg(p)).rank.selected === "Lore-Speaker");
await p.selectOption('dialog select[name="target"]', { label: "Nia (Initiate)" });
check("back to Initiate -> Attendant default", (await dlg(p)).rank.selected === "Attendant");
await shot(p, "01-dialog.png");
await post(p, {});
log("cards", await cards(p));
check("card posted, nothing changed before Apply", (await ranks(p)).nia === "Academic Rank: Initiate" && (await cards(p))[0].apply);
await shot(p, "02-card-before-apply.png");
await apply(p, 0);
log("ranks", await ranks(p), await cards(p), await p.evaluate(() => calls));
check("Nia has only Attendant", (await ranks(p)).nia === "Academic Rank: Attendant");
check("others untouched", (await ranks(p)).sera === "Academic Rank: Initiate" && (await ranks(p)).pregen === "Academic Rank: Initiate");
check("card shows applied, no button", (await cards(p))[0].card === "Academia: applied (Academic Rank: Attendant)." && !(await cards(p))[0].apply);
await p.evaluate(() => renderChat()); check("re-render keeps no Apply button", !(await cards(p))[0].apply);
await shot(p, "03-single-applied.png"); await p.close();

log("== S2 Whole party via api.promote() ==");
p = await open();
await p.evaluate(() => { mod.api.promote(); }); await p.waitForSelector("dialog");
await post(p, { target: "Whole party (3 members)", rank: "attendant" });
let c = await cards(p); log("card", c);
check("preview lists each member, Tarek skipped, Sera re-evaluates", c[0].speaker === "Magaambya" && c[0].card.includes("Nia: Initiate → Attendant") && c[0].card.includes("Tarek: already Conversant (skipped)") && c[0].card.includes("Sera: Initiate → Attendant (re-evaluates Dedicated Attendant)") && !c[0].card.includes("Pregen"));
await shot(p, "04-party-preview.png");
await apply(p, 0);
let r = await ranks(p);
const cl = await p.evaluate(() => window.calls);
log("ranks", r, await cards(p)); log("document calls", cl);
check("party upgraded, higher rank kept, non-member untouched", r.nia === "Academic Rank: Attendant" && r.sera === "Academic Rank: Attendant" && r.tarek === "Academic Rank: Conversant" && r.pregen === "Academic Rank: Initiate");
check("no writes to Tarek/Pregen/NPC", !cl.some(x => /^(Tarek|Pregen|Pugwampi)/.test(x)));
const sera = cl.filter(x => x.startsWith("Sera:")).map(x => x.split(":")[1]);
check("Sera order create -> delete -> actor update", sera.join() === "create,delete,setFlag", sera);
await shot(p, "05-party-applied.png"); await p.close();

log("== S3 adversarial: stale cards, double click, rapid re-promote ==");
p = await open();
for (const rank of ["attendant", "lore-speaker", "conversant"]) { await chat(p, "/promote"); await p.waitForSelector("dialog"); await post(p, { target: (await dlg(p)).target.options[0], rank }); }
await apply(p, 1);
log("cards after Lore-Speaker applied", await cards(p));
c = await cards(p);
check("stale lower cards show skipped without Apply", !c[0].apply && !c[2].apply && c[0].card.includes("already Lore-Speaker (skipped)") && c[2].card.includes("already Lore-Speaker (skipped)"), c);
check("only Lore-Speaker owned", (await ranks(p)).nia === "Academic Rank: Lore-Speaker");
await shot(p, "06-stale-cards.png");
// stale button still on screen (not re-rendered) clicked after higher rank applied
await chat(p, "/promote"); await p.waitForSelector("dialog"); await post(p, { target: "Sera (Initiate)", rank: "attendant" });
await chat(p, "/promote"); await p.waitForSelector("dialog"); await post(p, { target: "Sera (Initiate)", rank: "conversant" });
await p.evaluate(() => { const a = document.querySelector('.msg[data-i="3"] button'); window.staleBtn = a; });
await apply(p, 4); await p.evaluate(async () => { staleBtn.click(); await new Promise(r => setTimeout(r, 200)); });
check("clicking a detached stale Apply never demotes", (await ranks(p)).sera === "Academic Rank: Conversant", (await ranks(p)).sera);
await chat(p, "/promote"); await p.waitForSelector("dialog"); await post(p, { target: "Pregen (not in party) (Initiate)", rank: "attendant" });
const before = await p.evaluate(() => calls.length);
await p.evaluate(async () => { const b = document.querySelector('.msg[data-i="5"] button'); b.click(); b.click(); b.click(); await new Promise(r => setTimeout(r, 300)); });
const delta = await p.evaluate(b => calls.slice(b), before); log("triple-click calls", delta);
check("triple click applies once", delta.filter(x => x.includes(":create:")).length === 1 && (await ranks(p)).pregen === "Academic Rank: Attendant");
// all-above party card
await chat(p, "/promote"); await p.waitForSelector("dialog"); await post(p, { target: "Whole party (3 members)", rank: "attendant" });
c = await cards(p); log("party card", c.at(-1));
check("party card: only below-rank member listed as upgrade", c.at(-1).card.includes("Nia: already Lore-Speaker (skipped)") && c.at(-1).card.includes("Sera: already Conversant (skipped)") && !c.at(-1).apply);
// cancel
const m = await p.evaluate(() => messages.length); await chat(p, "/promote"); await p.waitForSelector("dialog"); await p.evaluate(() => document.querySelector("dialog").close()); await p.waitForSelector("dialog", { state: "detached" }); await p.waitForTimeout(200);
check("cancelling dialog posts nothing", await p.evaluate(() => messages.length) === m);
await p.close();

log("== S4 player cannot promote ==");
p = await open(false);
await chat(p, "/promote"); await p.waitForTimeout(200);
check("player /promote warns, no dialog", !(await p.$("dialog")) && (await p.textContent("#toast")).includes("Only the GM"), await p.textContent("#toast"));
await p.evaluate(() => { window.useHook = true; calls.length = 0; mod.api.promote(by("nia")); }); await p.waitForTimeout(200);
check("player api.promote(actor) warns, no dialog", !(await p.$("dialog")) && (await p.evaluate(() => calls)).some(x => x.startsWith("warn:")));
await p.evaluate(async () => { await ChatMessage.create({ speaker: { actor: "nia", alias: "Nia" }, content: "<p>Nia advances.</p>", flags: { thousands: { promote: { id: "z", rank: "attendant" } } } }); });
c = await cards(p); log("player card", c);
check("player sees card without Apply", c[0].card?.includes("Initiate → Attendant") && !c[0].apply);
await shot(p, "07-player.png"); await p.close();

log("== S5 api.promote(actor), chatMessage-hook path, no party, no characters ==");
p = await open();
await p.evaluate(() => { mod.api.promote(by("nia")); }); await p.waitForSelector("dialog");
d = await dlg(p); log(d); check("explicit actor: only that actor, no target select", !d.target && d.who.includes("Nia (Initiate)"));
for (const [i, rank] of ["attendant", "conversant", "lore-speaker"].entries()) {
  if (i) { await p.evaluate(() => { mod.api.promote(by("nia")); }); await p.waitForSelector("dialog"); }
  check(`default next rank is ${rank}`, (await p.$eval('dialog select[name="rank"]', e => e.value)) === rank);
  await post(p, {}); await apply(p, i); log("nia", await ranks(p).then(x => x.nia));
}
check("end of ladder single Lore-Speaker feat", (await ranks(p)).nia === "Academic Rank: Lore-Speaker");
await p.evaluate(() => { window.useHook = true; calls.length = 0; gameActors.party = null; }); await chat(p, "/promote"); await p.waitForSelector("dialog");
d = await dlg(p); check("hook path opens dialog; no Whole party without active party", !d.target.options.join().includes("Whole party") && (await p.evaluate(() => calls)).includes("via:chatMessage-hook"), d.target.options);
await p.evaluate(() => document.querySelector("dialog").close()); await p.waitForSelector("dialog", { state: "detached" }); await p.waitForTimeout(100);
await p.evaluate(() => { calls.length = 0; gameActors.splice(0); mod.api.promote(); }); await p.waitForTimeout(200);
check("no characters warns", !(await p.$("dialog")) && (await p.evaluate(() => calls)).some(x => x.includes("Select a token")));
await p.evaluate(() => { calls.length = 0; mod.api.promote(by("npc")); }); await p.waitForTimeout(200);
check("api.promote(NPC) warns", !(await p.$("dialog")) && (await p.evaluate(() => calls)).length === 1);
await p.close();
await browser.close();

log("== S6 built compendium pack ==");
const f = (n) => pack.find(x => x.name === n);
const comp = f("Magaambyan Attendant Dedication Rules");
log("pack key", keys.find(k => k.endsWith(comp._id)), "uuid", comp._stats.compendiumSource);
log("companion rules", comp.system.rules);
const das = pack.filter(x => x.name.endsWith("(Level 3): Dedicated Attendant"));
log("sample Dedicated Attendant rules", das[0].system.rules);
check("companion in pack under resolvable key", keys.includes(`!items!${comp._id}`) && comp._stats.compendiumSource === `Compendium.thousands.academia-feats.Item.${comp._id}`);
check("5 Dedicated Attendant feats grant dedication + companion, gated to Attendant+", das.length === 5 && das.every(x => { const g = x.system.rules.filter(r => r.key === "GrantItem"); return g.map(r => r.uuid).join() === `Compendium.pf2e.feats-srd.Item.ZhToff996PnTESwb,${comp._stats.compendiumSource}` && g.every(r => r.reevaluateOnUpdate && r.allowDuplicate === false && r.predicate[0].or.length === 3); }));
check("unique ids", new Set(pack.map(x => x._id)).size === pack.length);
check("no page errors", errors.length === 0, errors);
log(`failed checks: ${failed}`);
writeFileSync(resolve(ev, "promote-harness-transcript.txt"), out.join("\n") + "\n");
process.exit(failed ? 1 : 0);
