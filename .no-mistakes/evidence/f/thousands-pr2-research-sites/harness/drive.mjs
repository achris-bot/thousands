// Usage (from the repo root, after `vite build`): node drive.mjs <evidence-dir>
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const root = process.cwd(), out = process.argv[2], here = dirname(new URL(import.meta.url).pathname);
const { ClassicLevel } = createRequire(join(root, "package.json"))("classic-level");
const db = new ClassicLevel(join(root, "dist/packs/academia-feats"), { keyEncoding: "utf8", valueEncoding: "json" });
const feats = await db.sublevel("items", { keyEncoding: "utf8", valueEncoding: "json" }).values().all();
await db.close();

const server = http.createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u === "/feats.json") return r.end(JSON.stringify(feats));
  const file = u.startsWith("/dist/") ? join(root, u) : join(here, u === "/" ? "index.html" : u);
  try { const body = readFileSync(file); r.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : "text/html"); r.end(body); }
  catch { r.statusCode = 404; r.end(); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const profile = resolve(root, ".nm-chrome"); mkdirSync(profile, { recursive: true });
const chrome = spawn("chromium", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1200,850", "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const log = [], results = {};
let current = "";
try {
  const wsUrl = await new Promise((ok, no) => { let s = ""; chrome.stderr.on("data", (d) => { s += d; const m = s.match(/DevTools listening on (ws:\S+)/); if (m) ok(m[1]); }); chrome.on("exit", () => no(new Error(s))); });
  const port = new URL(wsUrl).port;
  const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let n = 0; const pending = new Map(); const pageErrors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)(m); else if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => new Promise((ok, no) => { pending.set(++n, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  const js = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception.description); return r.result.value; };
  const tick = () => js("new Promise(r=>setTimeout(r,60))");
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1200, height: 850, deviceScaleFactor: 1, mobile: false });

  const scenario = (name) => { current = name; results[name] = []; log.push(`\n## ${name}`); };
  const check = (label, actual, expected) => { const ok = JSON.stringify(actual) === JSON.stringify(expected); results[current].push(ok); log.push(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`); };
  const has = (label, text, part, want = true) => { const ok = text.includes(part) === want; results[current].push(ok); log.push(`${ok ? "PASS" : "FAIL"} ${label}: ${want ? "contains" : "omits"} "${part}"${ok ? "" : ` in "${text}"`}`); };
  const shot = async (name) => { await tick(); writeFileSync(join(out, name), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64")); };
  const click = async (sel) => {
    const p = await js(`(()=>{const e=${sel};if(!e)return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!p) throw new Error("no element " + sel);
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
    await tick();
  };
  const command = async (text) => {
    await click(`document.querySelector("#cmd")`); await cdp("Input.insertText", { text });
    for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await tick();
  };
  const fresh = async (specs) => {
    await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); if (await js("window.ready===true").catch(() => false)) break; }
    await js(`game.actors=${JSON.stringify(specs)}.map(s=>makeActor(FEATS,s));void 0`);
  };
  const set = (name, value) => js(`(()=>{const e=document.querySelector('dialog [name="${name}"]');e.value=${JSON.stringify(String(value))};if(e.value!==${JSON.stringify(String(value))})throw new Error("no option ${value} in ${name}");e.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  const dialog = () => js(`(()=>{const d=document.querySelector("dialog");if(!d)return null;const q=n=>d.querySelector('[name="'+n+'"]');return {sites:[...q("site").options].map(o=>o.textContent),skills:[...q("skill").options].map(o=>o.value).filter(Boolean),skill:q("skill").value,dc:Number(q("dc").value),telepathy:getComputedStyle(d.querySelector(".thousands-telepathy")).display!=="none"}})()`);
  const research = async ({ actor = 0, site = "", kind = "primary", outcome = "", skill, tele, note, die } = {}) => {
    await command("/research");
    if (!(await dialog())) return;
    await set("actor", actor); await set("site", site); await set("kind", kind);
    if (skill !== undefined) await set("skill", skill);
    if (tele) await click(`document.querySelector('dialog [name="telepathy"]')`);
    await set("outcome", outcome);
    if (note) { await click(`document.querySelector('dialog [name="note"]')`); await cdp("Input.insertText", { text: note }); }
    if (die !== undefined) await js(`d20.push(${die})`);
    await click(`document.querySelector('dialog [data-action="research"]')`);
  };
  const card = () => js(`document.querySelector("#log li:last-child")?.innerText.replace(/\\s+/g," ").trim()??""`);
  const applyBtn = `document.querySelector("#log li:last-child .thousands-study button")`;
  const hasApply = () => js(`!!${applyBtn}`);
  const apply = async () => { await click(applyBtn); };
  const state = (i = 0) => js(`(()=>{const a=game.actors[${i}];const opts=a.items.map(it=>FEATS.find(f=>f.system.slug===it.system.slug).system.rules.map(r=>r.option).find(o=>String(o).startsWith("academia:"))).filter(Boolean);const lv={};for(const o of opts){const m=o.match(/^academia:branch:([\\w-]+):level:(\\d+)$/);if(m)lv[m[1]]=Math.max(lv[m[1]]??0,+m[2])}return {levels:lv,conditions:{...a.conditions},flags:a.flags["thousands.study"]??{}}})()`);
  const records = async (i = 0) => Object.values((await state(i)).flags.applied ?? {});
  const sheet = (i = 0) => js(`(()=>{const a=game.actors[${i}];document.querySelector("#sheet").textContent=a.name+" (level "+a.level+")\\nconditions: "+JSON.stringify(a.conditions)+"\\nflags.thousands.study: "+JSON.stringify(a.flags["thousands.study"]??{},null,1)})()`);
  const persisted = {};
  const keep = async (name, i = 0) => { persisted[name] = await state(i); };
  const AMARA = { name: "Amara", level: 6, primary: ["uzunjati", 2], secondary: ["cascade-bearers", 3] };
  const BAKARI = { name: "Bakari", level: 6, primary: ["rain-scribes", 2], secondary: ["emerald-boughs", 0], rank: "lore-speaker" };

  // ---------------------------------------------------------------
  scenario("dialog: site presets filter skills, set DC, toggle telepathy, keep typed DC");
  await fresh([AMARA, BAKARI]);
  await command("/research");
  let d = await dialog();
  check("site options", d.sites.length, 8); log.push("     " + d.sites.join(" | "));
  check("freeform default skills count (any skill)", d.skills.length, 18);
  check("freeform default DC (level 2)", d.dc, 16);
  await shot("01-dialog-freeform.png");
  const expect = { bloodsalt: ["diplomacy"], "vacant-eye": ["nature", "society"], "mzali-necropolis": ["religion"], osibu: ["diplomacy", "society"], "red-star-doorway": ["occultism"], "hall-of-reason": ["occultism"], "endless-table": ["nature"] };
  for (const [site, bonus] of Object.entries(expect)) {
    await set("site", site); d = await dialog();
    check(`${site} Uzunjati skills (crafting + lores + bonus)`, [...d.skills].sort(), ["academia-lore", "crafting", "warfare-lore", ...bonus].sort());
    check(`${site} DC`, d.dc, site === "hall-of-reason" ? 21 : 16);
    check(`${site} telepathy checkbox visible`, d.telepathy, site === "hall-of-reason");
  }
  await set("site", "hall-of-reason"); await shot("02-dialog-hall-of-reason.png");
  await set("kind", "secondary"); d = await dialog();
  check("HoR secondary Cascade Bearers skills", [...d.skills].sort(), ["arcana", "occultism", "religion"]);
  check("HoR secondary level 3 DC 18+5", d.dc, 23);
  await set("actor", 1); await set("kind", "primary"); await set("site", "vacant-eye"); d = await dialog();
  check("Bakari Rain-Scribes at Vacant Eye (deduped, no lore)", [...d.skills].sort(), ["medicine", "nature", "society", "survival"]);
  await click(`document.querySelector('dialog [name="dc"]')`); await js(`document.querySelector('dialog [name="dc"]').select()`); await cdp("Input.insertText", { text: "30" });
  await set("site", "hall-of-reason"); await set("actor", 0); d = await dialog();
  check("typed DC kept through site/actor change", d.dc, 30);
  await set("site", ""); d = await dialog(); check("back to freeform restores any skill", d.skills.length, 18);
  await click(`document.querySelector('dialog [data-action="close"]')`);

  // ---------------------------------------------------------------
  scenario("rolled check: site DC, label, override DC");
  await fresh([AMARA]);
  await research({ site: "hall-of-reason", skill: "occultism", die: 12 });
  let r = await js("rolls.at(-1)");
  check("HoR roll DC", r.dc, 21);
  check("roll options carry site + no telepathy", r.options.includes("thousands:research-site:hall-of-reason:no-telepathy"), true);
  has("card (22 vs 21 success downgraded)", await card(), "no telepathy: result is one degree worse");
  await command("/research"); await set("site", "red-star-doorway"); await set("skill", "occultism");
  await click(`document.querySelector('dialog [name="dc"]')`); await js(`document.querySelector('dialog [name="dc"]').select()`); await cdp("Input.insertText", { text: "25" }); await js("d20.push(15)");
  await click(`document.querySelector('dialog [data-action="research"]')`);
  check("overridden DC used", (await js("rolls.at(-1)")).dc, 25);

  // ---------------------------------------------------------------
  scenario("Bloodsalt: crit success note; crit failure blocks next month's research once");
  await fresh([AMARA]);
  await research({ site: "bloodsalt", skill: "diplomacy", die: 20 });
  has("crit success card", await card(), "unlocks the Bloodsalt Dragon Disciple feats"); await apply();
  has("note stays after Apply", await card(), "unlocks the Bloodsalt Dragon Disciple feats");
  check("level +2", (await state()).levels.uzunjati, 4);
  await research({ site: "bloodsalt", skill: "diplomacy", die: 1 });
  has("crit failure card", await card(), "no Practical Research or Rebuild Kiutu"); await apply();
  check("skipNext set", (await state()).flags.skipNext, true);
  const rollsBefore = await js("rolls.length");
  await research({ site: "osibu", skill: "diplomacy", die: 15 });
  check("no check rolled while skip pending", await js("rolls.length"), rollsBefore);
  has("skip card", await card(), "must skip this opportunity");
  await shot("03-bloodsalt-skip.png");
  await apply(); check("skip cleared", (await state()).flags.skipNext, false);
  await research({ site: "bloodsalt", skill: "diplomacy", die: 10 });
  check("research works again", await js("rolls.length"), rollsBefore + 1);
  await keep("bloodsalt");

  // ---------------------------------------------------------------
  scenario("Prison of the Vacant Eye: crit failure records 1-year lockout, no skip or condition");
  await fresh([AMARA]);
  await research({ site: "vacant-eye", outcome: "criticalFailure" });
  has("card", await card(), "cannot research at this site for 1 year");
  has("no Study-skip text", await card(), "must skip the next Study", false);
  check("nothing recorded before Apply", await records(), []);
  await apply();
  has("applied card", await card(), "cannot research at this site for 1 year");
  check("history record", (await records()).map((x) => [x.site, x.result, x.skip]), [["vacant-eye", "criticalFailure", false]]);
  check("no skip/conditions", [(await state()).flags.skipNext, (await state()).conditions], [false, {}]);
  await keep("vacantEye");

  // ---------------------------------------------------------------
  scenario("Mzali Necropolis: Apply on crit failure gives doomed 1 and records permanent lockout");
  await fresh([AMARA]);
  await research({ site: "mzali-necropolis", skill: "religion", die: 1 });
  has("card", await card(), "permanently barred from this site");
  check("no condition before Apply", (await state()).conditions, {});
  await shot("04-mzali-before-apply.png");
  await apply(); await sheet(); await shot("05-mzali-after-apply.png");
  check("doomed 1", (await state()).conditions, { doomed: 1 });
  check("history", (await records()).map((x) => [x.site, x.result]), [["mzali-necropolis", "criticalFailure"]]);
  check("Apply button gone", await hasApply(), false);
  await js("render(messages.at(-1))"); check("re-render does not offer Apply again", await hasApply(), false);
  await keep("mzali");
  for (const [prior, after] of [[1, 1], [2, 2]]) {
    await fresh([AMARA]); await js(`game.actors[0].conditions.doomed=${prior}`);
    await research({ site: "mzali-necropolis", outcome: "criticalFailure" }); await apply();
    check(`existing doomed ${prior} does not stack`, (await state()).conditions.doomed, after);
  }
  await fresh([AMARA]); await research({ site: "mzali-necropolis", outcome: "failure" }); await apply();
  check("plain failure: no doomed", (await state()).conditions, {});

  // ---------------------------------------------------------------
  scenario("Osibu: per-actor Treasure Points +2/+1/+1, capped at 4, crit failure lockout");
  await fresh([AMARA, BAKARI]);
  for (const [outcome, text] of [["criticalSuccess", "Treasure Points 0 → 2"], ["failure", "Treasure Points 2 → 3"], ["success", "Treasure Points 3 → 4"], ["criticalSuccess", "Treasure Points 4 → 4"]]) {
    await research({ site: "osibu", outcome }); has(`${outcome} preview`, await card(), text); await apply();
  }
  has("applied card keeps total", await card(), "Treasure Points 4 (max 4)");
  await research({ actor: 1, site: "osibu", outcome: "success" }); has("other actor independent", await card(), "Treasure Points 0 → 1"); await apply();
  await research({ site: "osibu", outcome: "criticalFailure" });
  has("crit failure", await card(), "barred from this site until after 1 month serving the city"); has("crit failure adds none", await card(), "Treasure Points 4 → 4"); await apply();
  check("Amara history", (await records()).map((x) => x.result), ["criticalSuccess", "failure", "success", "criticalSuccess", "criticalFailure"]);
  await shot("06-osibu.png"); await keep("osibu");
  await fresh([AMARA]);
  await research({ site: "osibu", skill: "diplomacy", die: 20 }); await apply();
  await js("reroll(messages.at(-1).id, 7)"); await tick(); has("reroll to failure previews replacement", await card(), "replaces the old one"); await apply();
  has("reroll replaces, not stacks", await card(), "Treasure Points 1 (max 4)");

  // ---------------------------------------------------------------
  scenario("Red Star Doorway: Mpondo note on crit success, 1-week repair lockout on crit failure");
  await fresh([AMARA]);
  await research({ site: "red-star-doorway", skill: "occultism", die: 20 }); has("crit success", await card(), "Mpondo's attitude improves by 1 step"); await apply(); has("after Apply", await card(), "Mpondo's attitude improves by 1 step");
  await research({ site: "red-star-doorway", outcome: "success" }); has("success has no note", await card(), "Mpondo", false);
  await research({ site: "red-star-doorway", outcome: "criticalFailure", note: "cracked lintel" }); has("crit failure", await card(), "must spend 1 week repairing the site"); await apply(); has("free note kept", await card(), "cracked lintel");
  check("history", (await records()).map((x) => [x.site, x.result]).at(-1), ["red-star-doorway", "criticalFailure"]);
  await keep("redStar");

  // ---------------------------------------------------------------
  scenario("Hall of Reason: telepathy degree shift, Akitonian, drained 2 on crit failure");
  await fresh([AMARA]);
  await research({ site: "hall-of-reason", outcome: "criticalSuccess", tele: true }); has("telepath crit success", await card(), "learns the Akitonian language"); has("no shift", await card(), "one degree worse", false); await apply();
  check("+2", (await state()).levels.uzunjati, 4);
  await fresh([AMARA]);
  await research({ site: "hall-of-reason", outcome: "criticalSuccess" }); has("non-telepath crit success downgraded", await card(), "one degree worse"); has("no Akitonian", await card(), "Akitonian", false); await apply();
  check("only +1", (await state()).levels.uzunjati, 3);
  await fresh([AMARA]);
  await research({ site: "hall-of-reason", outcome: "success" }); await apply(); check("non-telepath success = failure (+0)", (await state()).levels.uzunjati, 2); check("failure: no drained", (await state()).conditions, {});
  await research({ site: "hall-of-reason", outcome: "failure" }); has("non-telepath failure = crit failure", await card(), "drained 2 and barred from this site for 1 week");
  check("no drained before Apply", (await state()).conditions, {}); await apply(); check("drained 2", (await state()).conditions, { drained: 2 });
  await sheet(); await shot("07-hall-of-reason-drained.png"); await keep("hallNonTelepath");
  await fresh([AMARA]);
  await research({ site: "hall-of-reason", skill: "occultism", tele: true, die: 8 }); check("telepath plain failure", (await js("rolls.at(-1)")).outcome, "failure"); await apply(); check("telepath failure: no drained", (await state()).conditions, {});

  // ---------------------------------------------------------------
  scenario("reroll adversarial: undo removes only what the site added");
  for (const prior of [0, 1, 3]) {
    await fresh([AMARA]); if (prior) await js(`game.actors[0].conditions.drained=${prior}`);
    await research({ site: "hall-of-reason", skill: "occultism", tele: true, die: 1 }); await apply();
    check(`prior ${prior}: after crit failure`, (await state()).conditions.drained, Math.max(prior, 2));
    await js("reroll(messages.at(-1).id, 15)"); await tick(); await apply();
    check(`prior ${prior}: after reroll to success`, (await state()).conditions.drained ?? 0, prior);
    check(`prior ${prior}: single record`, (await records()).map((x) => x.result), ["success"]);
  }
  await fresh([AMARA]);
  await research({ site: "bloodsalt", skill: "diplomacy", die: 1 }); await apply(); await js("reroll(messages.at(-1).id, 15)"); await tick(); await apply();
  check("Bloodsalt reroll clears its skip", (await state()).flags.skipNext, false);

  // ---------------------------------------------------------------
  scenario("The Endless Table: primary and secondary uncapped to 20");
  await fresh([AMARA]);
  await research({ kind: "secondary", outcome: "criticalSuccess" }); await apply(); check("freeform secondary capped at 3", (await state()).levels["cascade-bearers"], 3);
  await research({ kind: "secondary", site: "endless-table", outcome: "criticalSuccess" }); has("preview", await card(), "Cascade Bearers 3 → 5"); await apply(); check("secondary 3 → 5", (await state()).levels["cascade-bearers"], 5);
  await shot("08-endless-secondary-uncapped.png");
  await research({ kind: "secondary", site: "osibu", outcome: "success" }); await apply(); check("other site still capped", (await state()).levels["cascade-bearers"], 5);
  await fresh([{ ...AMARA, primary: ["uzunjati", 19], secondary: ["cascade-bearers", 19] }]);
  for (const kind of ["primary", "secondary"]) { await research({ kind, site: "endless-table", outcome: "criticalSuccess" }); await apply(); }
  check("clamped at 20", (await state()).levels, { uzunjati: 20, "cascade-bearers": 20 });
  await command("/research"); await set("site", "endless-table"); check("DC at level 20", (await dialog()).dc, 40); await click(`document.querySelector('dialog [data-action="close"]')`);

  // ---------------------------------------------------------------
  scenario("The Endless Table: cumulative -2 circumstance penalty on later research there");
  await fresh([AMARA, BAKARI]);
  const roll = async (site, die, actor = 0) => { await research({ actor, site, skill: site === "endless-table" ? "nature" : "diplomacy", die }); return js("rolls.at(-1)"); };
  r = await roll("endless-table", 1); check("first roll has no penalty", r.modifiers, []); has("card shows penalty", await card(), "-2 circumstance penalty to later research at The Endless Table"); await apply();
  check("no Study skip", (await state()).flags.skipNext, false);
  r = await roll("endless-table", 1); check("second roll -2", r.modifiers.map((m) => [m.modifier, m.type]), [[-2, "circumstance"]]); has("cumulative", await card(), "-4 circumstance penalty"); await apply();
  r = await roll("endless-table", 15); check("third roll -4", r.modifiers.map((m) => m.modifier), [-4]); await shot("09-endless-penalty.png");
  r = await roll("osibu", 10); check("no penalty at another site", r.modifiers, []);
  r = await roll("endless-table", 10, 1); check("no penalty for another actor", r.modifiers, []);
  await keep("endlessTable");

  // ---------------------------------------------------------------
  scenario("freeform research unchanged; player cannot run /research or Apply");
  await fresh([AMARA]);
  await research({ skill: "athletics", die: 1 }); r = await js("rolls.at(-1)"); check("freeform DC/options", [r.dc, r.options.some((o) => o.includes("research-site"))], [16, false]);
  has("freeform crit failure skips next", await card(), "must skip the next Study opportunity"); await apply(); check("skipNext", (await state()).flags.skipNext, true); check("no conditions", (await state()).conditions, {});
  await fresh([AMARA]);
  await research({ site: "mzali-necropolis", outcome: "criticalFailure" });
  await js("game.user.isGM=false;render(messages.at(-1))"); check("player has no Apply", await hasApply(), false);
  await command("/research"); check("player gets no dialog", await dialog(), null); check("warning", (await js("warnings.at(-1)")), "Only the GM can record Practical Research.");
  check("page errors", pageErrors, []);
  writeFileSync(join(out, "persisted-actor-state.json"), JSON.stringify(persisted, null, 2));
  ws.close();
} catch (e) { log.push("DRIVER ERROR in " + current + ": " + e.stack); process.exitCode = 2; }
finally {
  chrome.kill(); await new Promise((r) => (chrome.exitCode !== null || chrome.signalCode ? r() : chrome.on("exit", r))); server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const all = Object.entries(results).map(([k, v]) => `${v.every(Boolean) ? "PASS" : "FAIL"} (${v.filter(Boolean).length}/${v.length}) ${k}`);
  writeFileSync(join(out, "research-drive-transcript.log"), all.join("\n") + "\n" + log.join("\n") + "\n");
  console.log(all.join("\n")); console.log(log.filter((l) => /FAIL|ERROR/.test(l)).join("\n"));
  if (Object.values(results).flat().includes(false)) process.exitCode ||= 1;
}
