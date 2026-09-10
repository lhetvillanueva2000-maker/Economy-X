/**
 * ============================================================
 *  EconomyX — 3D dropped-item props
 *  Playing cards and the EX Tool render as real 3D models when
 *  dropped, by swapping the vanilla item entity for a custom prop
 *  entity that carries a geometry.
 * ============================================================
 *  TRADE-OFF, read before changing anything:
 *  a prop is NOT an item entity. Dropped cards and tools therefore
 *  cannot be collected by hoppers, minecarts or /kill @e[type=item],
 *  and they do not merge with other stacks on the ground. Everything
 *  else — gravity, pickup, the 5-minute despawn — is reproduced here.
 *
 *  Set ENABLE_3D_DROPS to false for plain vanilla flat drops. Nothing
 *  else in EconomyX depends on this module.
 * ============================================================
 */

import { world, system, ItemStack } from "@minecraft/server";

const ENABLE_3D_DROPS = true;
const PICKUP_RADIUS = 1.6;
const PICKUP_DELAY = 10; // ticks before a prop can be collected
const DESPAWN_TICKS = 6000; // 5 minutes, matching vanilla
const PICKUP_RATE = 4; // how often the pickup loop runs
const SWEEP_RATE = 100; // how often the despawn sweep runs

const PROP_FAMILY = "ex_prop";
const TOOL_ID = "ex:ex_tool";

const SUITS = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = ["ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king"];

/**
 * Card -> variant index. MUST stay in lockstep with the "c0".."c54" texture
 * list in RP/entity/card_prop.entity.json and with the Array.skins order in
 * RP/render_controllers/ex_props.render_controllers.json, or dropped cards
 * show the wrong face.
 */
const CARD_INDEX = {};
let n = 0;
for (const suit of SUITS) for (const rank of RANKS) CARD_INDEX[`ex:card_${rank}_of_${suit}`] = n++;
CARD_INDEX["ex:card_joker_red"] = 52;
CARD_INDEX["ex:card_joker_black"] = 53;
CARD_INDEX["ex:card_face_down"] = 54;

const isCardId = (id) => Object.prototype.hasOwnProperty.call(CARD_INDEX, id);

/** entity.isValid is a property on @minecraft/server 2.x and a method on 1.x. */
function alive(e) {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------
 *  Item state
 *  The original script stored only a type id and a count, so an
 *  enchanted or half-worn EX Tool came back brand new — losing its
 *  enchantments and silently repairing itself every time it was
 *  dropped. Durability, enchantments, name and lore now round-trip.
 * ---------------------------------------------------------- */

function packItem(stack) {
  const out = { id: stack.typeId, amount: stack.amount };
  try {
    if (stack.nameTag) out.name = stack.nameTag;
  } catch {
    /* no-op */
  }
  try {
    const lore = stack.getLore();
    if (lore?.length) out.lore = lore;
  } catch {
    /* no-op */
  }
  try {
    const dur = stack.getComponent("minecraft:durability");
    if (dur) out.damage = dur.damage;
  } catch {
    /* no-op */
  }
  try {
    const ench = stack.getComponent("minecraft:enchantable");
    if (ench) {
      const list = ench.getEnchantments().map((e) => ({ id: e.type?.id ?? String(e.type), lvl: e.level }));
      if (list.length) out.ench = list;
    }
  } catch {
    /* no-op */
  }
  return out;
}

function unpackItem(data) {
  const stack = new ItemStack(data.id, Math.max(1, data.amount ?? 1));
  try {
    if (data.name) stack.nameTag = data.name;
  } catch {
    /* no-op */
  }
  try {
    if (data.lore?.length) stack.setLore(data.lore);
  } catch {
    /* no-op */
  }
  try {
    if (typeof data.damage === "number") {
      const dur = stack.getComponent("minecraft:durability");
      if (dur) dur.damage = Math.min(data.damage, dur.maxDurability);
    }
  } catch {
    /* no-op */
  }
  try {
    if (data.ench?.length) {
      const ench = stack.getComponent("minecraft:enchantable");
      if (ench) {
        for (const e of data.ench) {
          try {
            ench.addEnchantment({ type: e.id, level: e.lvl });
          } catch {
            /* an enchantment the item can no longer hold — skip it */
          }
        }
      }
    }
  } catch {
    /* no-op */
  }
  return stack;
}

/* ------------------------------------------------------------
 *  Conversion: vanilla item entity -> prop entity
 * ---------------------------------------------------------- */

function convert(itemEnt) {
  if (!alive(itemEnt)) return;

  let stack;
  try {
    stack = itemEnt.getComponent("minecraft:item")?.itemStack;
  } catch {
    return;
  }
  if (!stack) return;

  const id = stack.typeId;
  const card = isCardId(id);
  if (!card && id !== TOOL_ID) return;

  const dim = itemEnt.dimension;
  const loc = { x: itemEnt.location.x, y: itemEnt.location.y, z: itemEnt.location.z };
  const packed = packItem(stack);

  try {
    itemEnt.remove();
  } catch {
    return;
  }

  let prop;
  try {
    prop = dim.spawnEntity(card ? "ex:card_prop" : "ex:tool_prop", loc);
  } catch {
    // Could not place the prop — put the real item back rather than eat it.
    try {
      dim.spawnItem(unpackItem(packed), loc);
    } catch {
      /* no-op */
    }
    return;
  }

  if (card) {
    try {
      prop.setProperty("ex:variant", CARD_INDEX[id]);
    } catch {
      /* no-op */
    }
  }
  try {
    prop.setDynamicProperty("ex:payload", JSON.stringify(packed));
    prop.setDynamicProperty("ex:born", system.currentTick);
  } catch {
    /* no-op */
  }
}

if (ENABLE_3D_DROPS) {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    const e = ev.entity;
    if (!e || e.typeId !== "minecraft:item") return;
    system.run(() => {
      try {
        convert(e);
      } catch (err) {
        console.warn(`[EconomyX] prop convert: ${err}`);
      }
    });
  });
}

/* ------------------------------------------------------------
 *  Pickup
 *  The original build kept every prop in an in-memory Set. A prop
 *  whose chunk unloaded was dropped from that Set, and when the chunk
 *  came back the prop was in the world but tracked by nothing — it
 *  could never be picked up and never despawned. Querying by type
 *  family instead means the world itself is the source of truth, so
 *  chunk churn and rejoins cannot strand anything.
 * ---------------------------------------------------------- */

/** Returns the prop's age in ticks, healing the counter across a reload. */
function ageOf(prop) {
  const born = prop.getDynamicProperty("ex:born");
  const now = system.currentTick;
  if (typeof born !== "number" || born > now) {
    // system.currentTick restarts at 0 on world reload, which would otherwise
    // make the age negative and the prop immortal.
    try {
      prop.setDynamicProperty("ex:born", now);
    } catch {
      /* no-op */
    }
    return 0;
  }
  return now - born;
}

function collect(player, prop) {
  const raw = prop.getDynamicProperty("ex:payload");
  if (typeof raw !== "string") {
    try {
      prop.remove();
    } catch {
      /* no-op */
    }
    return;
  }

  let packed;
  try {
    packed = JSON.parse(raw);
  } catch {
    return;
  }

  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;

  const leftover = inv.addItem(unpackItem(packed));
  if (leftover) {
    // Inventory full: keep what would not fit on the ground.
    packed.amount = leftover.amount;
    try {
      prop.setDynamicProperty("ex:payload", JSON.stringify(packed));
    } catch {
      /* no-op */
    }
    return;
  }

  try {
    player.playSound("random.pop", { location: player.location });
  } catch {
    /* no-op */
  }
  try {
    prop.remove();
  } catch {
    /* no-op */
  }
}

if (ENABLE_3D_DROPS) {
  system.runInterval(() => {
    try {
      for (const player of world.getAllPlayers()) {
        try {
          // Spectators walk through the world without hoovering up drops.
          if (player.getGameMode?.() === "spectator") continue;

          const near = player.dimension.getEntities({
            families: [PROP_FAMILY],
            location: player.location,
            maxDistance: PICKUP_RADIUS
          });
          for (const prop of near) {
            if (!alive(prop)) continue;
            if (ageOf(prop) < PICKUP_DELAY) continue;
            collect(player, prop);
          }
        } catch {
          /* skip this player, keep the loop alive */
        }
      }
    } catch (err) {
      console.warn(`[EconomyX] prop pickup: ${err}`);
    }
  }, PICKUP_RATE);

  // Despawn sweep, matching vanilla's 5-minute item lifetime.
  system.runInterval(() => {
    try {
      for (const name of ["overworld", "nether", "the_end"]) {
        try {
          for (const prop of world.getDimension(name).getEntities({ families: [PROP_FAMILY] })) {
            if (!alive(prop)) continue;
            if (ageOf(prop) > DESPAWN_TICKS) {
              try {
                prop.remove();
              } catch {
                /* no-op */
              }
            }
          }
        } catch {
          /* dimension not loaded */
        }
      }
    } catch (err) {
      console.warn(`[EconomyX] prop sweep: ${err}`);
    }
  }, SWEEP_RATE);
}
