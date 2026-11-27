import { MODULE_ID } from "../constants.js";
import {
  BRANCH_IDS,
  RANKS,
  RANK_LABELS,
  isAttendantOrHigher,
  isRank,
  nextRank,
  rankIndex,
  type Rank,
} from "../rules/index.js";
import { featFor, levelOption, readState, type ActorLike, type ItemLike } from "./academia.js";
import type { MessageLike } from "./chat.js";

export type PromoteActor = ActorLike & { id?: string; name: string };
export interface PromoteFlags {
  applied?: Record<string, { previous: Rank; next: Rank }>;
}
export interface PromoteFlag {
  id: string;
  rank: Rank;
  actorIds?: string[];
}
export interface PromotePick {
  actor?: PromoteActor;
  party?: boolean;
  rank: Rank;
}
export interface PromoteUi {
  pickPromote(
    actors: readonly PromoteActor[],
    partyMembers: readonly PromoteActor[],
  ): Promise<PromotePick | null>;
  warn(text: string): void;
  postPromote(actors: readonly PromoteActor[], data: PromoteFlag): Promise<unknown>;
  newId(): string;
}

export const PROMOTABLE_RANKS: readonly Rank[] = RANKS.filter((r) => r !== "initiate");
export const rankOption = (rank: Rank) => `academia:rank:${rank}`;
const RANK_SLUGS = new Map<string, Rank>(RANKS.map((r) => [featFor(rankOption(r)).system.slug, r]));
const DEDICATED_ATTENDANT_SLUGS = new Set(
  BRANCH_IDS.map((id) => featFor(levelOption(id, 3)).system.slug),
);

const readPromoteFlags = (actor: ActorLike): PromoteFlags => {
  const raw = actor.getFlag(MODULE_ID, "promote");
  return raw && typeof raw === "object" ? (raw as PromoteFlags) : {};
};

export const ownedRankItems = (actor: ActorLike): { rank: Rank; item: ItemLike }[] =>
  [...actor.items].flatMap((item) => {
    const rank = item.system.slug ? RANK_SLUGS.get(item.system.slug) : undefined;
    return rank ? [{ rank, item }] : [];
  });

export const ownsDedicatedAttendant = (actor: ActorLike): boolean =>
  [...actor.items].some((i) => !!i.system.slug && DEDICATED_ATTENDANT_SLUGS.has(i.system.slug));

export function defaultPromoteRank(actors: readonly ActorLike[]): Rank {
  if (actors.length === 0) return "attendant";
  const lowestIdx = Math.min(...actors.map((a) => rankIndex(readState(a).rank)));
  return nextRank(RANKS[lowestIdx]!) ?? "lore-speaker";
}

export function promoteEntryFromMessage(message: MessageLike): PromoteFlag | null {
  const data = message.flags[MODULE_ID]?.promote as PromoteFlag | undefined;
  if (!data || typeof data.id !== "string" || !isRank(data.rank)) return null;
  const actorIds = Array.isArray(data.actorIds)
    ? data.actorIds.filter((x): x is string => typeof x === "string")
    : [];
  return { id: data.id, rank: data.rank, ...(actorIds.length ? { actorIds } : {}) };
}

/** Plans an upgrade-only rank promotion; actors already at or above `rank` are never demoted. */
export function planPromote(actor: ActorLike, rank: Rank) {
  const currentRank = readState(actor).rank;
  const currentIdx = rankIndex(currentRank);
  const targetIdx = rankIndex(rank);
  const owned = ownedRankItems(actor);
  if (currentIdx > targetIdx) {
    return {
      currentRank,
      targetRank: rank,
      removeIds: [] as string[],
      needsCreate: false,
      changed: false,
      reevaluatesDedicatedAttendant: false,
      summary: `already ${RANK_LABELS[currentRank]} (skipped).`,
    };
  }
  const keepTarget = owned.find((e) => e.rank === rank);
  const removeIds = owned.filter((e) => e.item.id !== keepTarget?.item.id).map((e) => e.item.id);
  const needsCreate = !keepTarget;
  const changed = needsCreate || removeIds.length > 0;
  const reevaluatesDedicatedAttendant =
    ownsDedicatedAttendant(actor) && !isAttendantOrHigher(currentRank) && isAttendantOrHigher(rank);
  const base = !changed
    ? `already ${RANK_LABELS[rank]}`
    : currentRank === rank
      ? `sets Academic Rank: ${RANK_LABELS[rank]}`
      : `${RANK_LABELS[currentRank]} → ${RANK_LABELS[rank]}`;
  const note = reevaluatesDedicatedAttendant ? " (re-evaluates Dedicated Attendant)" : "";
  return {
    currentRank,
    targetRank: rank,
    removeIds,
    needsCreate,
    changed,
    reevaluatesDedicatedAttendant,
    summary: `${base}${note}.`,
  };
}

/**
 * Upgrades an actor's Academic Rank feat in place (skipping actors already at or above `entry.rank`),
 * then writes the promote flag so PF2e re-evaluates `Dedicated Attendant` (`ATTENDANT_PLUS_PREDICATE`).
 */
export async function applyPromote(actor: ActorLike, entry: PromoteFlag): Promise<boolean> {
  const flags = readPromoteFlags(actor);
  if (flags.applied?.[entry.id]) return false;
  const planned = planPromote(actor, entry.rank);
  if (!planned.changed) return false;
  // Create the new rank feat before deleting older rank feats so Attendant+ predicates stay active.
  if (planned.needsCreate) {
    await actor.createEmbeddedDocuments("Item", [structuredClone(featFor(rankOption(entry.rank)))]);
  }
  if (planned.removeIds.length > 0) await actor.deleteEmbeddedDocuments("Item", planned.removeIds);
  const applied = {
    ...(flags.applied ?? {}),
    [entry.id]: { previous: planned.currentRank, next: entry.rank },
  };
  await actor.setFlag(MODULE_ID, "promote", { applied });
  return true;
}

export function describePromote(
  actors: readonly PromoteActor[],
  entry: PromoteFlag,
): { text: string; done: boolean } {
  if (actors.length === 0) return { text: "no matching character found.", done: true };
  const plans = actors.map((actor) => ({
    actor,
    applied: readPromoteFlags(actor).applied?.[entry.id],
    plan: planPromote(actor, entry.rank),
  }));
  const label = RANK_LABELS[entry.rank];
  const appliedList = plans.filter((p) => !!p.applied);
  const remaining = plans.filter((p) => !p.applied && p.plan.changed);
  if (appliedList.length > 0 && remaining.length === 0) {
    if (plans.length === 1) return { text: `applied (Academic Rank: ${label}).`, done: true };
    const promoted = appliedList.map((p) => p.actor.name).join(", ");
    const skipped = plans
      .filter((p) => !p.applied)
      .map((p) => p.actor.name)
      .join(", ");
    const detail = skipped ? `${promoted}; skipped: ${skipped}` : promoted;
    return { text: `applied (Academic Rank: ${label} — ${detail}).`, done: true };
  }
  const done = remaining.length === 0;
  if (plans.length === 1) return { text: plans[0]!.plan.summary, done };
  return {
    text: `${plans.map(({ actor, plan }) => `${actor.name}: ${plan.summary.replace(/\.$/, "")}`).join(" | ")}.`,
    done,
  };
}

export async function startPromote(
  actors: readonly PromoteActor[],
  ui: PromoteUi,
  partyMembers: readonly PromoteActor[] = [],
): Promise<void> {
  if (actors.length === 0 && partyMembers.length === 0) {
    return ui.warn("Select a token or assign a character to promote.");
  }
  const picked = await ui.pickPromote(actors, partyMembers);
  if (!picked) return;
  const targets = picked.party ? [...partyMembers] : picked.actor ? [picked.actor] : [];
  if (targets.length === 0) return ui.warn("Choose a character or an active party to promote.");
  const actorIds = picked.party ? targets.flatMap((a) => (a.id ? [a.id] : [])) : undefined;
  await ui.postPromote(targets, {
    id: ui.newId(),
    rank: picked.rank,
    ...(actorIds?.length ? { actorIds } : {}),
  });
}
