/**
 * ============================================================
 *  EconomyX — rule guards
 *   1. Playing cards belong to players. Mobs never hold them.
 *   2. The EX Tool carries a fixed enchantment range in survival.
 * ============================================================
 */

import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";

const GUARD_RATE = 40; // ticks between mob sweeps (2 seconds)
const ENCHANT_RATE = 60; // ticks between tool checks (3 seconds)

const TOOL_ID = "ex:ex_tool";

const SUITS = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = ["ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king"];

/**
 * Items only a player may hold. A zombie that scoops up a dropped hand of
 * cards and walks around waving them breaks the fiction, so anything in here
 * is taken back off a mob and returned to the ground.
 *
 * The EX Tool is deliberately NOT in this list — add "ex:ex_tool" here if you
 * also want mobs barred from picking that up.
 */
const PLAYER_ONLY = new Set();
for (const suit of SUITS) for (const rank of RANKS) PLAYER_ONLY.add(`ex:card_${rank}_of_${suit}`);
PLAYER_ONLY.add("ex:card_joker_red");
PLAYER_ONLY.add("ex:card_joker_black");
PLAYER_ONLY.add("ex:card_face_down");

/**
 * What the EX Tool is allowed to carry for a player in survival or adventure.
 * The pickaxe enchant slot would otherwise also offer Fortune and Silk Touch,
 * which are not part of the intended range.
 *
 * Creative is skipped entirely, so /enchant can put anything on the tool there.
 * A tool enchanted in creative and then carried into survival WILL be trimmed
 * back to this list — set ENFORCE_IN_SURVIVAL to false to leave it alone.
 */
const ENFORCE_IN_SURVIVAL = true;
const TOOL_ENCHANTS = {
  "minecraft:efficiency": 5,
  "minecraft:unbreaking": 3,
  "minecraft:mending": 1
};

const EQUIP_SLOTS = [
  EquipmentSlot.Mainhand,
  EquipmentSlot.Offhand,
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet
];

function alive(e) {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid;
  } catch {
    return false;
  }
}

/** Creative players are exempt from the enchantment range. */
function isCreative(player) {
  try {
    const gm = player.getGameMode?.();
    return gm === "creative" || gm === "Creative";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------
 *  1. Mobs may not hold playing cards
 *
 *  Vanilla mobs with can_pick_up_loot (zombies, skeletons, piglins,
 *  foxes and friends) will happily grab a dropped card. Cards taken
 *  off a mob are dropped back on the floor rather than deleted, so a
 *  card is never destroyed by this guard. With 3D drops on, the card
 *  becomes a prop entity within a tick and mobs cannot pick a prop up
 *  at all, so it does not simply get grabbed again.
 *
 *  Scoped to the "mob" type family, which leaves armour stands, item
 *  frames and other display entities free to hold a card.
 * ---------------------------------------------------------- */

function stripCardsFrom(entity) {
  const eq = entity.getComponent("minecraft:equippable");
  if (!eq) return;

  for (const slot of EQUIP_SLOTS) {
    let held;
    try {
      held = eq.getEquipment(slot);
    } catch {
      continue;
    }
    if (!held || !PLAYER_ONLY.has(held.typeId)) continue;

    const returned = new ItemStack(held.typeId, held.amount);
    try {
      eq.setEquipment(slot, undefined);
    } catch {
      continue;
    }
    try {
      entity.dimension.spawnItem(returned, entity.location);
    } catch {
      /* could not place it back — better than leaving it on the mob */
    }
  }
}

system.runInterval(() => {
  try {
    for (const name of ["overworld", "nether", "the_end"]) {
      try {
        for (const mob of world.getDimension(name).getEntities({ families: ["mob"] })) {
          if (!alive(mob)) continue;
          if (mob.typeId === "minecraft:player") continue;
          stripCardsFrom(mob);
        }
      } catch {
        /* dimension not loaded */
      }
    }
  } catch (err) {
    console.warn(`[EconomyX] mob card guard: ${err}`);
  }
}, GUARD_RATE);

/* ------------------------------------------------------------
 *  2. EX Tool enchantment range
 *
 *  Survival and adventure: Efficiency I-V, Unbreaking I-III, Mending I.
 *  Anything else is removed and over-levelled enchantments are clamped.
 *  Creative is untouched, so /enchant works without limits there.
 * ---------------------------------------------------------- */

/** Trims one tool to the allowed set. Returns true if it had to change. */
function trimTool(stack) {
  const ench = stack.getComponent("minecraft:enchantable");
  if (!ench) return false;

  let list;
  try {
    list = ench.getEnchantments();
  } catch {
    return false;
  }
  if (!list.length) return false;

  const keep = [];
  let changed = false;
  for (const e of list) {
    const id = e.type?.id ?? String(e.type);
    const max = TOOL_ENCHANTS[id];
    if (max === undefined) {
      changed = true; // not part of the survival range
      continue;
    }
    const level = Math.min(e.level, max);
    if (level !== e.level) changed = true;
    keep.push({ id, level });
  }
  if (!changed) return false;

  try {
    ench.removeAllEnchantments();
  } catch {
    return false;
  }
  for (const k of keep) {
    try {
      ench.addEnchantment({ type: k.id, level: k.level });
    } catch {
      /* the item can no longer take it — drop it silently */
    }
  }
  return true;
}

if (ENFORCE_IN_SURVIVAL) {
  system.runInterval(() => {
    try {
      for (const player of world.getAllPlayers()) {
        try {
          if (isCreative(player)) continue;
          const inv = player.getComponent("minecraft:inventory")?.container;
          if (!inv) continue;

          for (let i = 0; i < inv.size; i++) {
            const stack = inv.getItem(i);
            if (!stack || stack.typeId !== TOOL_ID) continue;
            if (trimTool(stack)) {
              inv.setItem(i, stack);
              player.sendMessage("§e[EconomyX] The EX Tool only keeps Efficiency, Unbreaking and Mending outside creative.");
            }
          }
        } catch {
          /* skip this player, keep the loop alive */
        }
      }
    } catch (err) {
      console.warn(`[EconomyX] tool enchant guard: ${err}`);
    }
  }, ENCHANT_RATE);
}
