/**
 * ============================================================
 *  EconomyX — rule guards
 *   Playing cards belong to players. Mobs never hold them.
 * ============================================================
 *  NOTE ON THE EX TOOL AND ENCHANTMENTS
 *  There is deliberately no enchantment policing here. /enchant needs
 *  operator, operator means cheats are on, so a survival player holding
 *  an EX Tool with Sharpness or the mace enchantments has visibly
 *  cheated — the server admin can see that without the mod stripping
 *  anything. The tool's minecraft:enchantable slot is "all" so those
 *  commands actually work.
 * ============================================================
 */

import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";
import { PHONE_IDS } from "./phone_data.js";

const GUARD_RATE = 40; // ticks between mob sweeps (2 seconds)

const SUITS = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = ["ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king"];

/**
 * Items only a player may hold. A zombie that scoops up a dropped hand of
 * cards and walks around waving them breaks the fiction, so anything in here
 * is taken back off a mob and returned to the ground.
 *
 * Phones are in here for a blunter reason than the cards: a phone costs 4,050
 * UD and cannot be crafted at any price, so a zombie wandering off wearing
 * one is a genuinely expensive loss rather than a broken bit of fiction.
 *
 * The EX Tool is deliberately NOT in this list — add "ex:ex_tool" here if you
 * also want mobs barred from picking that up.
 */
const PLAYER_ONLY = new Set();
for (const suit of SUITS) for (const rank of RANKS) PLAYER_ONLY.add(`ex:card_${rank}_of_${suit}`);
PLAYER_ONLY.add("ex:card_joker_red");
PLAYER_ONLY.add("ex:card_joker_black");
PLAYER_ONLY.add("ex:card_face_down");
for (const id of PHONE_IDS) PLAYER_ONLY.add(id);

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

/* ------------------------------------------------------------
 *  Mobs may not hold playing cards
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
