import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RANKS,
  RANK_LABELS,
  isAttendantOrHigher,
  isRank,
  nextRank,
  rankIndex,
  type Rank,
} from "../src/rules/index.js";
import { featFor, levelOption, readState } from "../src/study/academia.js";
import type { MessageLike } from "../src/study/chat.js";
import { promote, registerStudy, renderPromoteCard } from "../src/study/foundry.js";
import {
  PROMOTABLE_RANKS,
  applyPromote,
  defaultPromoteRank,
  describePromote,
  ownedRankItems,
  planPromote,
  promoteEntryFromMessage,
  rankOption,
  startPromote,
  type PromoteFlags,
  type PromotePick,
  type PromoteUi,
} from "../src/study/promote.js";

afterEach(() => vi.unstubAllGlobals());

function makeActor(
  id: string,
  name: string,
  ranks: Rank[] = ["initiate"],
  opts: { dedicatedAttendant?: boolean; type?: string } = {},
) {
  let next = 0;
  const slugs = ranks.map((r) => featFor(rankOption(r)).system.slug);
  if (opts.dedicatedAttendant) slugs.push(featFor(levelOption("cascade-bearers", 3)).system.slug);
  const calls: string[] = [];
  const actor = {
    id,
    name,
    type: opts.type ?? "character",
    level: 3,
    calls,
    promoteFlag: {} as PromoteFlags,
    items: slugs.map((slug) => ({ id: `i${next++}`, system: { slug } })),
    getFlag: (_scope: string, key: string) => (key === "promote" ? actor.promoteFlag : undefined),
    setFlag: vi.fn(async (_scope: string, key: string, value: unknown) => {
      calls.push(`setFlag:${key}`);
      if (key === "promote") actor.promoteFlag = value as PromoteFlags;
    }),
    createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: object[]) => {
      calls.push("create");
      for (const s of sources as { system: { slug: string } }[])
        actor.items.push({ id: `i${next++}`, system: { slug: s.system.slug } });
    }),
    deleteEmbeddedDocuments: vi.fn(async (_type: "Item", ids: string[]) => {
      calls.push("delete");
      actor.items = actor.items.filter((i) => !ids.includes(i.id));
    }),
  };
  return actor;
}

describe("academic rank promotion", () => {
  it("validates rank helpers, upgrades in place without demoting, and re-evaluates Dedicated Attendant", async () => {
    expect(RANKS.map((r) => RANK_LABELS[r])).toEqual([
      "Initiate",
      "Attendant",
      "Conversant",
      "Lore-Speaker",
    ]);
    expect(PROMOTABLE_RANKS).toEqual(["attendant", "conversant", "lore-speaker"]);
    expect(RANKS.map(rankIndex)).toEqual([0, 1, 2, 3]);
    expect(RANKS.map(nextRank)).toEqual(["attendant", "conversant", "lore-speaker", null]);
    expect(RANKS.map(isAttendantOrHigher)).toEqual([false, true, true, true]);
    expect([isRank("attendant"), isRank("archmage"), isRank(null)]).toEqual([true, false, false]);

    // Single actor: old rank removed, new rank granted, idempotent on second Apply.
    const nia = makeActor("a1", "Nia", ["initiate"]);
    const entry = { id: "p1", rank: "attendant" as const };
    expect(describePromote([nia], entry)).toEqual({ text: "Initiate → Attendant.", done: false });
    expect(await applyPromote(nia, entry)).toBe(true);
    expect(ownedRankItems(nia).map((r) => r.rank)).toEqual(["attendant"]);
    expect(readState(nia).rank).toBe("attendant");
    expect(describePromote([nia], entry)).toEqual({
      text: "applied (Academic Rank: Attendant).",
      done: true,
    });
    expect(await applyPromote(nia, entry)).toBe(false);
    expect(nia.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(nia.deleteEmbeddedDocuments).toHaveBeenCalledTimes(1);

    // Upgrade-only: stale card or lower target rank never demotes an actor already above target.
    const conversant = makeActor("a2", "Tarek", ["conversant"]);
    const staleCard = { id: "stale-att", rank: "attendant" as const };
    expect(describePromote([conversant], staleCard)).toEqual({
      text: "already Conversant (skipped).",
      done: true,
    });
    expect(await applyPromote(conversant, staleCard)).toBe(false);
    expect(ownedRankItems(conversant).map((r) => r.rank)).toEqual(["conversant"]);
    expect(conversant.calls).toEqual([]);

    // Cleans up duplicate/stale lower rank feats on upgrade and handles fresh actors with no rank feat.
    const messy = makeActor("a3", "Lina", ["initiate", "attendant"]);
    await applyPromote(messy, { id: "p2", rank: "conversant" });
    expect(ownedRankItems(messy).map((r) => r.rank)).toEqual(["conversant"]);

    const fresh = makeActor("a4", "Orin", []);
    await applyPromote(fresh, { id: "p3", rank: "attendant" });
    expect(ownedRankItems(fresh).map((r) => r.rank)).toEqual(["attendant"]);

    // Dedicated Attendant: create new rank -> delete old rank -> setFlag triggers reevaluateOnUpdate.
    const withDA = makeActor("a5", "Sera", ["initiate"], { dedicatedAttendant: true });
    expect(planPromote(withDA, "attendant")).toMatchObject({
      reevaluatesDedicatedAttendant: true,
      summary: "Initiate → Attendant (re-evaluates Dedicated Attendant).",
    });
    await applyPromote(withDA, { id: "p4", rank: "attendant" });
    expect(withDA.calls).toEqual(["create", "delete", "setFlag:promote"]);
    expect(ownedRankItems(withDA).map((r) => r.rank)).toEqual(["attendant"]);

    // Attendant -> Conversant creates Conversant before deleting Attendant so Attendant+ stays active.
    withDA.calls.length = 0;
    expect(planPromote(withDA, "conversant").reevaluatesDedicatedAttendant).toBe(false);
    await applyPromote(withDA, { id: "p5", rank: "conversant" });
    expect(withDA.calls).toEqual(["create", "delete", "setFlag:promote"]);
    expect(ownedRankItems(withDA).map((r) => r.rank)).toEqual(["conversant"]);
    expect(defaultPromoteRank([makeActor("x", "X", ["attendant"]), conversant])).toBe("conversant");
  });

  it("limits Whole party to PF2e active party members, supports /promote and api.promote(), and renders Apply cards", async () => {
    const a1 = makeActor("a1", "Nia", ["initiate"]);
    const a2 = makeActor("a2", "Tarek", ["conversant"]);
    const pregen = makeActor("a3", "Pregen", ["initiate"]);
    const npc = makeActor("npc1", "Pugwampi", ["initiate"], { type: "npc" });
    const makeUi = (pick: PromotePick | null): PromoteUi => ({
      pickPromote: vi.fn(async () => pick),
      warn: vi.fn(),
      postPromote: vi.fn(async () => undefined),
      newId: () => "pr1",
    });

    const partyUi = makeUi({ party: true, rank: "attendant" });
    await startPromote([a1, a2, pregen], partyUi, [a1, a2]);
    expect(partyUi.postPromote).toHaveBeenCalledWith([a1, a2], {
      id: "pr1",
      rank: "attendant",
      actorIds: ["a1", "a2"],
    });
    const emptyUi = makeUi(null);
    await startPromote([], emptyUi, []);
    expect(emptyUi.warn).toHaveBeenCalledOnce();

    const hooks: Record<string, (...args: unknown[]) => unknown> = {};
    const CHAT_COMMANDS: Record<string, { rgx: RegExp; fn: () => boolean }> = {};
    const created: { content: string; flags: Record<string, Record<string, unknown>> }[] = [];
    const warn = vi.fn();
    const mod: { api?: Record<string, unknown> } = {};
    const user = { isGM: false, character: a1 };
    const fields: Record<string, string> = { target: "party", rank: "attendant" };
    // prettier-ignore
    const wait = vi.fn(async (cfg: { content: string; render?: (e: unknown, d: { element?: unknown }) => void; buttons: { action: string; callback: (e: unknown, b: { form: { elements: { namedItem(n: string): { value: string } | null } } }) => unknown }[] }) =>
      cfg.buttons.find((b) => b.action === "promote")!.callback(null, { form: { elements: { namedItem: (n: string) => ({ value: fields[n] ?? "" }) } } }),
    );
    const actors = Object.assign([a1, a2, pregen, npc], {
      party: { members: [a1, a2, npc] } as { members: unknown[] } | null,
    });
    vi.stubGlobal("game", {
      user,
      actors,
      settings: { register: vi.fn(), get: () => undefined },
      modules: { get: () => mod },
    });
    vi.stubGlobal("canvas", { tokens: { controlled: [{ actor: npc }] } });
    vi.stubGlobal("ui", { notifications: { warn } });
    vi.stubGlobal("ChatMessage", {
      create: vi.fn(async (d: (typeof created)[number]) => created.push(d)),
      getSpeaker: (o?: { alias?: string }) => ({ alias: o?.alias ?? "Nia" }),
    });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => "pm-1", escapeHTML: (s: string) => s },
      applications: {
        api: { DialogV2: { wait } },
        sidebar: { tabs: { ChatLog: { CHAT_COMMANDS } } },
      },
    });
    vi.stubGlobal("Hooks", {
      on: (n: string, fn: (...args: unknown[]) => unknown) => {
        hooks[n] = fn;
      },
    });

    registerStudy();
    expect(mod.api?.promote).toBe(promote);
    expect(CHAT_COMMANDS.promote?.rgx.test("/promote")).toBe(true);

    await promote();
    expect(warn).toHaveBeenCalledWith("Only the GM can promote academic rank.");
    expect(wait).not.toHaveBeenCalled();

    // GM runs /promote: active party (a1, a2) is offered as Whole party; pregen & NPC excluded from party; Initiate not offered.
    user.isGM = true;
    expect(hooks.chatMessage?.({}, "<p>/promote</p>")).toBe(false);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    const dialogCfg = wait.mock.calls[0]![0];
    expect(dialogCfg.content).toContain('value="party">Whole party (2 members)');
    expect(dialogCfg.content).not.toContain("Pugwampi");
    expect(dialogCfg.content).not.toContain('value="initiate"');
    expect(created[0]).toEqual({
      speaker: { alias: "Magaambya" },
      content: "<p>The party advances to Academic Rank: Attendant.</p>",
      flags: { thousands: { promote: { id: "pm-1", rank: "attendant", actorIds: ["a1", "a2"] } } },
    });

    // Changing Target in the dialog updates the default New rank to match the selected actor.
    let onChange: (() => void) | undefined;
    const targetEl = {
      value: "1",
      addEventListener: (_e: string, fn: () => void) => (onChange = fn),
    };
    const rankEl = { value: "attendant" };
    dialogCfg.render?.(null, {
      element: { querySelector: (sel: string) => (sel.includes("target") ? targetEl : rankEl) },
    });
    onChange?.();
    expect(rankEl.value).toBe("lore-speaker");

    // Without an active PF2e party, Whole party is not offered.
    actors.party = null;
    wait.mockResolvedValueOnce(null);
    await promote();
    expect(wait.mock.calls.at(-1)![0].content).not.toContain('value="party"');

    const msg: MessageLike = {
      actor: null,
      flags: created[0]!.flags,
      update: vi.fn(async () => undefined),
    };
    expect(promoteEntryFromMessage(msg)).toEqual({
      id: "pm-1",
      rank: "attendant",
      actorIds: ["a1", "a2"],
    });

    const listeners: Record<string, () => Promise<void>> = {};
    type El = {
      tag: string;
      textContent: string;
      children: El[];
      append(...n: El[]): void;
      addEventListener(e: string, fn: () => Promise<void>): void;
    };
    const cards: El[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string): El => {
        const el: El = {
          tag,
          textContent: "",
          children: [],
          append: (...n) => el.children.push(...n),
          addEventListener: (e, fn) => {
            listeners[e] = fn;
          },
        };
        return el;
      },
    });
    const html = {
      querySelector: () => ({ append: (c: El) => cards.push(c) }),
    } as unknown as HTMLElement;
    const lastCard = () => ({
      text: cards.at(-1)!.children.find((n) => n.tag === "p")?.textContent ?? "",
      hasButton: cards.at(-1)!.children.some((n) => n.tag === "button"),
    });

    renderPromoteCard(msg, html, false);
    expect(lastCard()).toEqual({
      text: "Academia: Nia: Initiate → Attendant | Tarek: already Conversant (skipped).",
      hasButton: false,
    });
    renderPromoteCard(msg, html, true);
    expect(lastCard()).toEqual({
      text: "Academia: Nia: Initiate → Attendant | Tarek: already Conversant (skipped).",
      hasButton: true,
    });

    // Apply upgrades Nia (Initiate -> Attendant), skips Tarek (stays Conversant), and never touches Pregen.
    await listeners.click?.();
    expect(ownedRankItems(a1).map((r) => r.rank)).toEqual(["attendant"]);
    expect(ownedRankItems(a2).map((r) => r.rank)).toEqual(["conversant"]);
    expect(ownedRankItems(pregen).map((r) => r.rank)).toEqual(["initiate"]);
    expect(a2.calls).toEqual([]);
    expect(msg.update).toHaveBeenCalledOnce();
    renderPromoteCard(msg, html, true);
    expect(lastCard()).toEqual({
      text: "Academia: applied (Academic Rank: Attendant — Nia; skipped: Tarek).",
      hasButton: false,
    });
  });
});
