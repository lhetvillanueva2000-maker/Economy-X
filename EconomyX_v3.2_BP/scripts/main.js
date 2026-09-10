/**
 * ============================================================
 *  EconomyX (EX) — main.js
 *  Debit Card & Currency Economy System
 *  Namespace: ex
 *  Target:    Minecraft Bedrock 1.26.13+
 *  Author:    Usersainyy
 * ============================================================
 *  Architecture:
 *   - All card state (balance, debt, owner, PIN, lockout) lives
 *     as Dynamic Properties on the ItemStack instance itself, so
 *     every physical card keeps its own isolated balance and
 *     survives anvil renaming, drops, item frames, etc.
 *   - Terminals CAPTURE the card: it leaves the player's hand on
 *     sign-in and only comes back via Eject Card.
 *   - Every screen title is prefixed with UI_TAG so the resource
 *     pack's ui/server_form.json can restyle EconomyX forms and
 *     leave every other form in the game alone.
 * ============================================================
 */

import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { CONFIG, getTierForColor, getCreditTier, formatMoney } from "./config.js";
// Side-effect imports. props.js registers the 3D dropped-item props for the
// playing cards and the EX Tool; guards.js keeps cards out of mob hands and
// holds the EX Tool to its survival enchantment range. Nothing here calls
// into either.
import "./props.js";
import "./guards.js";
// phones.js is NOT a side-effect import. It exports one initialiser that main.js
// calls at the very bottom of this file, handing over the banking helpers below.
// That keeps card state owned in one place and avoids a circular import.
import { initPhones } from "./phones.js";

/* ------------------------------------------------------------
 *  Constants
 * ---------------------------------------------------------- */

const CARD_IDS = CONFIG.cardColors.map((c) => `ex:debit_card_${c}`);
const CREDIT_IDS = CONFIG.creditColors.map((c) => `ex:credit_card_${c}`);

/**
 * Invisible marker on the front of every EconomyX form title.
 * "§8§r" sets a colour then immediately resets it, so it renders as nothing
 * but is still visible to the #title_text binding in server_form.json.
 * Delete RP/ui/server_form.json and the marker simply stops being read —
 * every screen still works, it just looks like a stock Bedrock form.
 */
const UI_TAG = "§8§r";
function t(title) {
  return UI_TAG + title;
}

const DISPLAY_NAMES = {
  "minecraft:emerald": "Emerald",
  "minecraft:diamond": "Diamond",
  "ex:coin_bronze": "Bronze Coin",
  "ex:coin_two": "Two Coin",
  "ex:coin_silver": "Silver Coin",
  "ex:coin_gold": "Gold Coin",
  "ex:coin_fifty": "Fifty Coin",
  "ex:coin_hundred": "Hundred Coin",
  "ex:cash_one": "One Note",
  "ex:cash_two": "Two Note",
  "ex:cash_five": "Five Note",
  "ex:cash_single": "Cash Bill",
  "ex:cash_fifty": "Fifty Note",
  "ex:cash_stack": "Cash Stack",
  "ex:cash_two_hundred": "Two Hundred Note",
  "ex:cash_bundle": "Cash Bundle",
  "ex:cash_thousand": "Thousand Note"
};

/** Every physical money item, richest first — used to make and take change. */
const CASH_BY_VALUE = Object.keys(CONFIG.values)
  .filter((id) => id.startsWith("ex:"))
  .sort((a, b) => CONFIG.values[b] - CONFIG.values[a]);

/* ------------------------------------------------------------
 *  Low-level helpers
 * ---------------------------------------------------------- */

function displayNameFor(typeId) {
  return DISPLAY_NAMES[typeId] ?? typeId;
}

function colorFromTypeId(typeId) {
  return typeId.replace("ex:debit_card_", "");
}

function makeCardUid() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getHandItemRaw(player) {
  const eq = player.getComponent("minecraft:equippable");
  if (!eq) return undefined;
  return eq.getEquipment(EquipmentSlot.Mainhand);
}

function setHandItemRaw(player, itemStack) {
  const eq = player.getComponent("minecraft:equippable");
  if (!eq) return;
  eq.setEquipment(EquipmentSlot.Mainhand, itemStack);
}

/**
 * While a terminal is holding the player's card, every read/write transparently
 * targets that captured card instead of the (now empty) hand. This lets all the
 * menu code keep working untouched.
 *
 * The card-in-hand handlers must use getHandItemRaw/setHandItemRaw instead, or a
 * stale capture makes a brand-new card read as the old one.
 */
function getMainhandItem(player) {
  const entry = heldCards.get(player.id);
  if (entry) return entry.stack;
  return getHandItemRaw(player);
}

function setMainhandItem(player, itemStack) {
  const entry = heldCards.get(player.id);
  if (entry) {
    if (itemStack) entry.stack = itemStack;
    return;
  }
  setHandItemRaw(player, itemStack);
}

/** Re-validates the player still has the expected debit card before continuing. */
function requireCard(player, expectedUid) {
  const item = getMainhandItem(player);
  if (!item || !CARD_IDS.includes(item.typeId)) {
    player.sendMessage("§cYou are no longer holding a debit card.");
    return null;
  }
  if (expectedUid) {
    const uid = item.getDynamicProperty("card_uid");
    if (uid !== expectedUid) {
      player.sendMessage("§cCard changed — action cancelled.");
      return null;
    }
  }
  return item;
}

function requireCreditCard(player, expectedUid) {
  const item = getMainhandItem(player);
  if (!item || !CREDIT_IDS.includes(item.typeId)) {
    player.sendMessage("§cYou are no longer holding a credit card.");
    return null;
  }
  if (expectedUid) {
    const uid = item.getDynamicProperty("card_uid");
    if (uid !== expectedUid) {
      player.sendMessage("§cCard changed — action cancelled.");
      return null;
    }
  }
  return item;
}

function countItem(player, typeId) {
  const container = player.getComponent("minecraft:inventory").container;
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (stack && stack.typeId === typeId) total += stack.amount;
  }
  return total;
}

function removeItems(player, typeId, amount) {
  const container = player.getComponent("minecraft:inventory").container;
  let remaining = amount;
  for (let i = 0; i < container.size && remaining > 0; i++) {
    const stack = container.getItem(i);
    if (stack && stack.typeId === typeId) {
      if (stack.amount <= remaining) {
        remaining -= stack.amount;
        container.setItem(i, undefined);
      } else {
        stack.amount -= remaining;
        container.setItem(i, stack);
        remaining = 0;
      }
    }
  }
  return remaining === 0;
}

function giveItems(player, typeId, amount) {
  const container = player.getComponent("minecraft:inventory").container;
  let remaining = amount;
  const maxStack = 64;
  while (remaining > 0) {
    const give = Math.min(remaining, maxStack);
    const stack = new ItemStack(typeId, give);
    const leftover = container.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
    remaining -= give;
  }
}

/* ------------------------------------------------------------
 *  Physical cash
 *  Gambling can now be funded straight out of the pocket, so cash
 *  has to be counted, taken and paid back across every denomination
 *  rather than a single stack.
 * ---------------------------------------------------------- */

/** Total UD value of every coin and note the player is carrying. */
function cashTotal(player) {
  let total = 0;
  for (const id of CASH_BY_VALUE) total += countItem(player, id) * CONFIG.values[id];
  return total;
}

/** Pays an amount out in the largest denominations that fit. */
function payOutCash(player, amount) {
  let remaining = Math.floor(amount);
  for (const id of CASH_BY_VALUE) {
    const value = CONFIG.values[id];
    const n = Math.floor(remaining / value);
    if (n > 0) {
      giveItems(player, id, n);
      remaining -= n * value;
    }
  }
  return remaining; // whatever was too small to represent (< 1 UD)
}

/**
 * Takes an amount out of the player's pocket, largest notes first, handing back
 * change when a note overshoots. Returns true if the full amount was collected.
 */
function collectCash(player, amount) {
  let remaining = Math.floor(amount);
  if (remaining <= 0) return true;
  if (cashTotal(player) < remaining) return false;

  for (const id of CASH_BY_VALUE) {
    if (remaining <= 0) break;
    const value = CONFIG.values[id];
    const have = countItem(player, id);
    if (have <= 0) continue;
    const take = Math.min(have, Math.floor(remaining / value));
    if (take > 0) {
      removeItems(player, id, take);
      remaining -= take * value;
    }
  }

  // Nothing left small enough to cover the remainder — break a bigger note.
  if (remaining > 0) {
    for (const id of CASH_BY_VALUE.slice().reverse()) {
      if (countItem(player, id) > 0 && CONFIG.values[id] >= remaining) {
        removeItems(player, id, 1);
        const change = CONFIG.values[id] - remaining;
        remaining = 0;
        if (change > 0) payOutCash(player, change);
        break;
      }
    }
  }
  return remaining <= 0;
}

/* ------------------------------------------------------------
 *  Card data (Dynamic Properties on the ItemStack instance)
 * ---------------------------------------------------------- */

function readCardData(itemStack) {
  return {
    registered: itemStack.getDynamicProperty("registered") === true,
    balance: itemStack.getDynamicProperty("card_balance") ?? 0,
    ownerUuid: itemStack.getDynamicProperty("owner_uuid") ?? "",
    ownerName: itemStack.getDynamicProperty("owner_name") ?? "",
    pin: itemStack.getDynamicProperty("pin_code") ?? "",
    attempts: itemStack.getDynamicProperty("pin_attempts") ?? 0,
    locked: itemStack.getDynamicProperty("locked_status") === true,
    cardUid: itemStack.getDynamicProperty("card_uid") ?? ""
  };
}

function writeCardData(itemStack, data) {
  // Dynamic Properties persist through anvil renaming, drops and item frames
  // because they are attached to the item's own instance data.
  itemStack.setDynamicProperty("registered", true);
  itemStack.setDynamicProperty("card_balance", data.balance);
  itemStack.setDynamicProperty("owner_uuid", data.ownerUuid);
  itemStack.setDynamicProperty("owner_name", data.ownerName);
  itemStack.setDynamicProperty("pin_code", data.pin);
  itemStack.setDynamicProperty("pin_attempts", data.attempts);
  itemStack.setDynamicProperty("locked_status", data.locked);
  itemStack.setDynamicProperty("card_uid", data.cardUid);
}

function creditTierFromTypeId(typeId) {
  return typeId.replace("ex:credit_card_", "");
}

function creditCardTitle(typeId) {
  return getCreditTier(creditTierFromTypeId(typeId)).label;
}

function debitCardTitle(typeId) {
  const label = colorFromTypeId(typeId)
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${label} Card`;
}

function readCreditData(itemStack) {
  return {
    registered: itemStack.getDynamicProperty("registered") === true,
    debt: itemStack.getDynamicProperty("card_debt") ?? 0,
    ownerUuid: itemStack.getDynamicProperty("owner_uuid") ?? "",
    ownerName: itemStack.getDynamicProperty("owner_name") ?? "",
    pin: itemStack.getDynamicProperty("pin_code") ?? "",
    attempts: itemStack.getDynamicProperty("pin_attempts") ?? 0,
    locked: itemStack.getDynamicProperty("locked_status") === true,
    cardUid: itemStack.getDynamicProperty("card_uid") ?? ""
  };
}

function writeCreditData(itemStack, data) {
  itemStack.setDynamicProperty("registered", true);
  itemStack.setDynamicProperty("card_debt", data.debt);
  itemStack.setDynamicProperty("owner_uuid", data.ownerUuid);
  itemStack.setDynamicProperty("owner_name", data.ownerName);
  itemStack.setDynamicProperty("pin_code", data.pin);
  itemStack.setDynamicProperty("pin_attempts", data.attempts);
  itemStack.setDynamicProperty("locked_status", data.locked);
  itemStack.setDynamicProperty("card_uid", data.cardUid);
}

/* ------------------------------------------------------------
 *  On-screen keypad
 *  Replaces text fields for PINs, account numbers and amounts.
 *  Because the only inputs are digit buttons, a 6-digit PIN can only
 *  ever be 6 digits — overtyping is impossible rather than rejected.
 *
 *  Layout matches the designs: 1-9 in a grid, then the three action
 *  keys. Confirm submits, Delete clears the box, Back returns to the
 *  screen you came from (and is omitted where there is nothing to
 *  go back to, e.g. the first step of signup).
 * ---------------------------------------------------------- */

const KEYPAD_BACK = Symbol("keypad_back");

/**
 * Shows a numeric keypad and resolves with the entered string.
 * Returns null if the player closed the form, or KEYPAD_BACK if they pressed
 * the Back key — callers route those two cases differently.
 *
 * `extraKeys` adds buttons after the standard ones (e.g. "Select All"); when one
 * is pressed the resolved value is { extra: <index>, entry: <digits so far> }.
 */
async function openKeypad(player, title, prompt, opts = {}) {
  const {
    length = CONFIG.security.pinLength,
    mask = false,
    confirmLabel = "Confirm",
    deleteLabel = "Delete",
    showBack = true,
    extraKeys = [],
    startEntry = ""
  } = opts;

  let entry = startEntry;

  for (;;) {
    const shown = mask
      ? "•".repeat(entry.length) + "_".repeat(Math.max(0, length - entry.length))
      : entry.length
        ? entry
        : "_".repeat(length);

    const form = new ActionFormData()
      .title(t(title))
      .body(`${prompt}\n\n§8[ §f§l${shown}§r§8 ]\n§7${entry.length} / ${length}`);

    for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) form.button(`§l${d}`);
    form.button("§0§l0");
    form.button(`§e${deleteLabel}`);
    form.button(`§a§l${confirmLabel}`);
    for (const k of extraKeys) form.button(k);
    if (showBack) form.button("§0Back");

    const res = await form.show(player);
    if (res.canceled) return null;

    const sel = res.selection;
    if (sel <= 8) {
      if (entry.length < length) entry += String(sel + 1);
      continue;
    }
    if (sel === 9) {
      if (entry.length < length) entry += "0";
      continue;
    }
    if (sel === 10) {
      // "Delete" clears the whole box, as specified in the UI notes.
      entry = "";
      continue;
    }
    if (sel === 11) {
      if (entry.length === 0) {
        player.sendMessage("§cNothing entered yet.");
        continue;
      }
      return entry;
    }
    const extraIndex = sel - 12;
    if (extraIndex >= 0 && extraIndex < extraKeys.length) {
      return { extra: extraIndex, entry };
    }
    return KEYPAD_BACK;
  }
}

/** True when a keypad result is a plain digit string rather than Back/extra/close. */
function isDigits(result) {
  return typeof result === "string";
}

/* ------------------------------------------------------------
 *  Account numbers
 *  Every card carries an account number chosen at signup. Numbers are
 *  unique within a card class — one debit and one credit card may share
 *  a number, but two debit cards may not.
 * ---------------------------------------------------------- */

const ACCOUNT_REGISTRY = { debit: "ex:accounts_debit", credit: "ex:accounts_credit" };

function loadAccounts(kind) {
  try {
    const raw = world.getDynamicProperty(ACCOUNT_REGISTRY[kind]);
    if (typeof raw !== "string" || !raw.length) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveAccounts(kind, map) {
  try {
    world.setDynamicProperty(ACCOUNT_REGISTRY[kind], JSON.stringify(map));
  } catch (e) {
    console.warn(`[EconomyX] account registry save: ${e}`);
  }
}

function accountAvailable(kind, number) {
  return !Object.prototype.hasOwnProperty.call(loadAccounts(kind), number);
}

function claimAccount(kind, number, ownerName, ownerUuid) {
  const map = loadAccounts(kind);
  map[number] = { owner: ownerName, uuid: ownerUuid, claimed: currentDay() };
  saveAccounts(kind, map);
}

function releaseAccount(kind, number) {
  const map = loadAccounts(kind);
  if (Object.prototype.hasOwnProperty.call(map, number)) {
    delete map[number];
    saveAccounts(kind, map);
  }
}

/** Puts the account number on the item's lore so it shows in the inventory. */
function stampCardLore(itemStack, accountNumber, kind) {
  try {
    itemStack.setLore([
      `§7Account No. §f${accountNumber}`,
      `§8${kind === "credit" ? "Credit" : "Debit"} · EconomyX`
    ]);
  } catch (e) {
    /* no-op */
  }
}

/* ------------------------------------------------------------
 *  Interest
 *  interest = debt * rate, rounded to 2dp, then added to the debt.
 *  Charged on every borrow, and again every CONFIG.interest.accrualDays
 *  in-game days that a balance is left outstanding.
 * ---------------------------------------------------------- */

function effectiveInterestRate(tierKey, debt) {
  const tier = getCreditTier(tierKey);
  let rate = tier.interestRate ?? 0.5;
  if (CONFIG.interest.debtPenaltyEnabled && tier.limit !== Infinity && tier.limit > 0) {
    const utilisation = Math.min(1, Math.max(0, debt / tier.limit));
    const scale = 1 + utilisation * (CONFIG.interest.maxDebtPenaltyMultiplier - 1);
    rate *= scale;
  }
  return Math.round(rate * 10000) / 10000;
}

function chargeInterest(tierKey, debt) {
  if (debt <= 0) return { interest: 0, newDebt: debt, rate: 0 };
  const rate = effectiveInterestRate(tierKey, debt);
  const interest = round2(debt * rate);
  return { interest, newDebt: round2(debt + interest), rate };
}

function currentDay() {
  try {
    return Math.floor(world.getAbsoluteTime() / 24000);
  } catch (e) {
    return 0;
  }
}

/**
 * Applies any overdue periodic interest to a credit card, then stamps it.
 * Runs lazily whenever a card is touched, so no global ticking is needed.
 */
function applyOverdueInterest(player, itemStack) {
  try {
    const data = readCreditData(itemStack);
    if (data.debt <= 0) {
      itemStack.setDynamicProperty("last_interest_day", currentDay());
      return 0;
    }
    const last = itemStack.getDynamicProperty("last_interest_day");
    const today = currentDay();
    if (typeof last !== "number") {
      itemStack.setDynamicProperty("last_interest_day", today);
      return 0;
    }
    const periods = Math.floor((today - last) / CONFIG.interest.accrualDays);
    if (periods <= 0) return 0;

    const tierKey = creditTierFromTypeId(itemStack.typeId);
    let debt = data.debt;
    let total = 0;
    for (let i = 0; i < periods; i++) {
      const res = chargeInterest(tierKey, debt);
      total += res.interest;
      debt = res.newDebt;
    }
    data.debt = debt;
    writeCreditData(itemStack, data);
    itemStack.setDynamicProperty("last_interest_day", last + periods * CONFIG.interest.accrualDays);

    if (total > 0) {
      player.sendMessage(
        `§c[EconomyX] ${formatMoney(round2(total))} interest charged on your ${creditCardTitle(itemStack.typeId)} ` +
          `(${periods} overdue period${periods > 1 ? "s" : ""}). Debt is now ${formatMoney(debt)}.`
      );
    }
    return total;
  } catch (err) {
    console.warn(`[EconomyX] interest accrual: ${err}`);
    return 0;
  }
}

/* ------------------------------------------------------------
 *  Machine sessions
 *  A terminal only trusts you for as long as your card is in the slot.
 * ---------------------------------------------------------- */

const machineSessions = new Map(); // playerId -> { cardUid, expiresTick }

function grantMachineSession(player, cardUid) {
  machineSessions.set(player.id, {
    cardUid,
    expiresTick: system.currentTick + CONFIG.machineSession.timeoutTicks
  });
}

function hasMachineSession(player, cardUid) {
  const s = machineSessions.get(player.id);
  if (!s) return false;
  if (s.cardUid !== cardUid) return false;
  if (system.currentTick > s.expiresTick) {
    machineSessions.delete(player.id);
    return false;
  }
  s.expiresTick = system.currentTick + CONFIG.machineSession.timeoutTicks;
  return true;
}

function endMachineSession(player) {
  machineSessions.delete(player.id);
}

/* ------------------------------------------------------------
 *  Card capture
 *  A real terminal swallows the card for the duration of the
 *  transaction. It only comes back via Eject Card or on logout —
 *  it is never destroyed.
 * ---------------------------------------------------------- */

const heldCards = new Map(); // playerId -> { stack, machine }

const CARD_PROPS = [
  "registered",
  "card_balance",
  "card_debt",
  "owner_uuid",
  "owner_name",
  "pin_code",
  "pin_attempts",
  "locked_status",
  "card_uid",
  "account_number",
  "last_interest_day"
];

const STRANDED_KEY = "ex:stranded_cards";

/** Flattens a card to plain JSON so a captured card can outlive a logout. */
function serializeCard(stack) {
  const props = {};
  for (const key of CARD_PROPS) {
    const v = stack.getDynamicProperty(key);
    if (v !== undefined) props[key] = v;
  }
  let lore = [];
  try {
    lore = stack.getLore();
  } catch (e) {
    /* no-op */
  }
  return { typeId: stack.typeId, props, lore };
}

function deserializeCard(obj) {
  const stack = new ItemStack(obj.typeId, 1);
  for (const [k, v] of Object.entries(obj.props ?? {})) stack.setDynamicProperty(k, v);
  try {
    if (obj.lore?.length) stack.setLore(obj.lore);
  } catch (e) {
    /* no-op */
  }
  return stack;
}

function loadStranded() {
  try {
    const raw = world.getDynamicProperty(STRANDED_KEY);
    if (typeof raw !== "string" || !raw.length) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveStranded(map) {
  try {
    world.setDynamicProperty(STRANDED_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn(`[EconomyX] stranded card save: ${e}`);
  }
}

/** Pulls the card out of the player's hand and into the machine. */
function captureCard(player, machine) {
  try {
    const item = getHandItemRaw(player);
    if (!item) return false;
    if (heldCards.has(player.id)) returnCard(player, true); // never stack two
    heldCards.set(player.id, { stack: item.clone(), machine });
    setHandItemRaw(player, undefined);
    try {
      player.playSound(CONFIG.sounds.cardInsert);
    } catch (e) {
      /* no-op */
    }
    return true;
  } catch (err) {
    console.warn(`[EconomyX] captureCard: ${err}`);
    return false;
  }
}

/** Gives the card back: hand, then inventory, then the floor. Never destroyed. */
function returnCard(player, quiet) {
  const entry = heldCards.get(player.id);
  if (!entry) return false;
  heldCards.delete(player.id);
  try {
    const held = getHandItemRaw(player);
    if (!held) {
      setHandItemRaw(player, entry.stack);
    } else {
      const inv = player.getComponent("minecraft:inventory").container;
      const leftover = inv.addItem(entry.stack);
      if (leftover) player.dimension.spawnItem(leftover, player.location);
    }
    if (!quiet) {
      try {
        player.playSound(CONFIG.sounds.cardReturn);
      } catch (e) {
        /* no-op */
      }
      actionBar(player, "§aCard ejected");
      holdActionBar(player, 40);
    }
    return true;
  } catch (err) {
    console.warn(`[EconomyX] returnCard: ${err}`);
    try {
      player.dimension.spawnItem(entry.stack, player.location);
    } catch (e) {
      /* no-op */
    }
    return true;
  }
}

function hasCapturedCard(player) {
  return heldCards.has(player.id);
}

/** Ends the session and hands the card back. The only real exit from a terminal. */
function ejectAndClose(player) {
  endMachineSession(player);
  returnCard(player, false);
}

/**
 * Returns the player to the home screen of whichever terminal holds their card.
 * Back buttons route here — only Eject gives the card back.
 */
function terminalHome(player, cardUid) {
  const entry = heldCards.get(player.id);
  if (!entry) return; // card already ejected; nothing to go back to
  const isCredit = CREDIT_IDS.includes(entry.stack.typeId);
  switch (entry.machine) {
    case "utm":
      return openUtmDebitMenu(player, cardUid);
    case "payment":
      return openPaymentHome(player, cardUid);
    case "atm":
      return isCredit ? openCreditCashAdvanceMenu(player, cardUid) : openAtmDenominationMenu(player, cardUid);
    default:
      return;
  }
}

/**
 * The form close (X) button cannot be removed in Bedrock. Terminal screens
 * therefore reopen themselves on cancel, so Eject Card is the only way out.
 */
function reopenOnCancel(player, reopen) {
  if (hasCapturedCard(player)) system.runTimeout(reopen, 5);
}

/* ------------------------------------------------------------
 *  Transaction feedback
 * ---------------------------------------------------------- */

function actionBar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch (e) {
    /* no-op */
  }
}

/** Suppresses the passive sneak-to-check readout so a confirmation stays up. */
const actionBarHold = new Map();
function holdActionBar(player, ticks = 60) {
  actionBarHold.set(player.id, system.currentTick + ticks);
}
function isActionBarHeld(player) {
  const until = actionBarHold.get(player.id);
  return until !== undefined && system.currentTick < until;
}

function confirmTransaction(player, action, detail, balanceText) {
  actionBar(player, `§aThe ${action} has been successful\n§7${detail}\n${balanceText}`);
  holdActionBar(player);
}

function failTransaction(player, action, reason) {
  actionBar(player, `§cThe ${action} was unsuccessful\n§7${reason}`);
  holdActionBar(player);
  try {
    player.playSound("note.bass");
  } catch (e) {
    /* no-op */
  }
}

function playFeedback(player, tier) {
  try {
    player.playSound(tier.useSound);
  } catch (e) {
    /* no-op */
  }
  if (tier.particle) {
    try {
      player.dimension.spawnParticle(tier.particle, player.location);
    } catch (e) {
      /* no-op */
    }
  }
}

function playLockoutFeedback(player) {
  try {
    player.playSound(CONFIG.lockout.sound);
  } catch (e) {
    /* no-op */
  }
  try {
    player.dimension.spawnParticle(CONFIG.lockout.particle, player.location);
  } catch (e) {
    /* no-op */
  }
}

/* ------------------------------------------------------------
 *  Registration wizard — Sign Up screen
 *  Account ID, then PIN, then Confirm PIN, all on the keypad.
 *  Signing up must NOT open a banking menu afterwards.
 * ---------------------------------------------------------- */

function signupBody(step, acct, pin1, pin2) {
  const line = (label, value, active) =>
    `${active ? "§f§l> " : "§8  "}${label}: ${value ? "§a" + value : "§8—"}§r`;
  return [
    line("Account ID", acct, step === 0),
    line("PIN", pin1 ? "•".repeat(pin1.length) : "", step === 1),
    line("Confirm PIN", pin2 ? "•".repeat(pin2.length) : "", step === 2)
  ].join("\n");
}

async function openRegistrationWizard(player) {
  const item = getHandItemRaw(player);
  if (!item || !CARD_IDS.includes(item.typeId)) return;

  const acctLen = CONFIG.security.accountNumberLength;
  const pinLen = CONFIG.security.pinLength;

  const acct = await openKeypad(player, "Sign Up — Debit", signupBody(0, "", "", ""), {
    length: acctLen,
    confirmLabel: "Confirm",
    deleteLabel: "Erase",
    showBack: false
  });
  if (!isDigits(acct)) {
    player.sendMessage("§cSignup cancelled.");
    return;
  }
  if (acct.length !== acctLen) {
    player.sendMessage(`§cThe account number must be exactly ${acctLen} digits.`);
    return openRegistrationWizard(player);
  }
  if (!accountAvailable("debit", acct)) {
    player.sendMessage("§cThis account number has already been taken. Choose another one.");
    return openRegistrationWizard(player);
  }

  const pin1 = await openKeypad(player, "Sign Up — Set PIN", signupBody(1, acct, "", ""), {
    length: pinLen,
    mask: true,
    confirmLabel: "Confirm",
    deleteLabel: "Erase",
    showBack: false
  });
  if (!isDigits(pin1) || pin1.length !== pinLen) {
    player.sendMessage("§cSignup cancelled.");
    return;
  }

  const pin2 = await openKeypad(player, "Sign Up — Confirm PIN", signupBody(2, acct, pin1, ""), {
    length: pinLen,
    mask: true,
    confirmLabel: "Confirm",
    deleteLabel: "Erase",
    showBack: false
  });
  if (!isDigits(pin2)) {
    player.sendMessage("§cSignup cancelled.");
    return;
  }
  if (pin1 !== pin2) {
    player.sendMessage("§cThose PINs did not match. Try again.");
    return openRegistrationWizard(player);
  }

  const item2 = getHandItemRaw(player);
  if (!item2 || !CARD_IDS.includes(item2.typeId)) {
    player.sendMessage("§cCard no longer in hand — signup cancelled.");
    return;
  }

  const data = {
    balance: 0,
    ownerUuid: player.id,
    ownerName: player.name,
    pin: pin1,
    attempts: 0,
    locked: false,
    cardUid: makeCardUid()
  };
  writeCardData(item2, data);
  item2.setDynamicProperty("account_number", acct);
  stampCardLore(item2, acct, "debit");
  setHandItemRaw(player, item2);
  claimAccount("debit", acct, player.name, player.id);

  player.sendMessage(`§aDebit account §f${acct} §aopened for §f${player.name}§a.`);
  playFeedback(player, getTierForColor(colorFromTypeId(item2.typeId)));
  actionBar(player, `§aAccount §f${acct} §aopened. Use an ATM or UTM to bank.`);
  holdActionBar(player);
}

async function openCreditRegistrationWizard(player) {
  const item = getHandItemRaw(player);
  if (!item || !CREDIT_IDS.includes(item.typeId)) return;

  const acctLen = CONFIG.security.accountNumberLength;
  const pinLen = CONFIG.security.pinLength;

  const acct = await openKeypad(player, "Sign Up — Credit", signupBody(0, "", "", ""), {
    length: acctLen,
    confirmLabel: "Confirm",
    deleteLabel: "Erase",
    showBack: false
  });
  if (!isDigits(acct)) {
    player.sendMessage("§cSignup cancelled.");
    return;
  }
  if (acct.length !== acctLen) {
    player.sendMessage(`§cThe account number must be exactly ${acctLen} digits.`);
    return openCreditRegistrationWizard(player);
  }
  if (!accountAvailable("credit", acct)) {
    player.sendMessage("§cThis account number has already been taken. Choose another one.");
    return openCreditRegistrationWizard(player);
  }

  const pin1 = await openKeypad(player, "Sign Up — Set PIN", signupBody(1, acct, "", ""), {
    length: pinLen,
    mask: true,
    confirmLabel: "Confirm",
    deleteLabel: "Erase",
    showBack: false
  });
  if (!isDigits(pin1) || pin1.length !== pinLen) {
    player.sendMessage("§cSignup cancelled.");
    return;
  }

  const pin2 = await openKeypad(player, "Sign Up — Confirm PIN", signupBody(2, acct, pin1, ""), {
    length: pinLen,
    mask: true,
    confirmLabel: "Confirm",
    deleteLabel: "Erase",
    showBack: false
  });
  if (!isDigits(pin2)) {
    player.sendMessage("§cSignup cancelled.");
    return;
  }
  if (pin1 !== pin2) {
    player.sendMessage("§cThose PINs did not match. Try again.");
    return openCreditRegistrationWizard(player);
  }

  const item2 = getHandItemRaw(player);
  if (!item2 || !CREDIT_IDS.includes(item2.typeId)) {
    player.sendMessage("§cCard no longer in hand — signup cancelled.");
    return;
  }

  const data = {
    debt: 0,
    ownerUuid: player.id,
    ownerName: player.name,
    pin: pin1,
    attempts: 0,
    locked: false,
    cardUid: makeCardUid()
  };
  writeCreditData(item2, data);
  item2.setDynamicProperty("account_number", acct);
  item2.setDynamicProperty("last_interest_day", currentDay());
  stampCardLore(item2, acct, "credit");
  setHandItemRaw(player, item2);
  claimAccount("credit", acct, player.name, player.id);

  player.sendMessage(`§aCredit account §f${acct} §aopened for §f${player.name}§a.`);
  try {
    player.playSound(CONFIG.sounds.cardInsert);
  } catch (e) {
    /* no-op */
  }
  actionBar(player, `§aCredit account §f${acct} §aopened.`);
  holdActionBar(player);
}

/* ------------------------------------------------------------
 *  Card in hand
 *  A plain tap does nothing. Only sneak + use opens signup or reports
 *  the card — terminal UIs are never reachable away from a machine.
 * ---------------------------------------------------------- */

function handleCardUse(player) {
  try {
    if (!player.isSneaking) return;
    // Read the REAL hand, never a card a terminal is holding.
    const item = getHandItemRaw(player);
    if (!item || !CARD_IDS.includes(item.typeId)) return;

    if (item.getDynamicProperty("registered") !== true) {
      openRegistrationWizard(player);
      return;
    }
    const data = readCardData(item);
    if (data.ownerUuid === player.id && data.locked) {
      data.locked = false;
      data.attempts = 0;
      writeCardData(item, data);
      setHandItemRaw(player, item);
      player.sendMessage("§aOwner verified — lockout cleared.");
      return;
    }
    const acct = item.getDynamicProperty("account_number") ?? "—";
    actionBar(player, `§2Acct §f${acct} §7| Balance: §a${formatMoney(data.balance)}`);
    holdActionBar(player);
  } catch (err) {
    console.warn(`[EconomyX] handleCardUse error: ${err}`);
  }
}

function handleCreditCardUse(player) {
  try {
    if (!player.isSneaking) return;
    const item = getHandItemRaw(player);
    if (!item || !CREDIT_IDS.includes(item.typeId)) return;

    if (item.getDynamicProperty("registered") !== true) {
      openCreditRegistrationWizard(player);
      return;
    }
    const data = readCreditData(item);
    if (data.ownerUuid === player.id && data.locked) {
      data.locked = false;
      data.attempts = 0;
      writeCreditData(item, data);
      setHandItemRaw(player, item);
      player.sendMessage("§aOwner verified — lockout cleared.");
      return;
    }
    applyOverdueInterest(player, item);
    setHandItemRaw(player, item);
    const acct = item.getDynamicProperty("account_number") ?? "—";
    const d2 = readCreditData(item);
    actionBar(player, `§4Acct §f${acct} §7| Debt: §c${formatMoney(d2.debt)}`);
    holdActionBar(player);
  } catch (err) {
    console.warn(`[EconomyX] handleCreditCardUse error: ${err}`);
  }
}

/* ============================================================
 *  TERMINALS
 * ============================================================ */

/** True if this head block is resting directly on an EconomyX machine base. */
function isOnMachineBase(block) {
  try {
    const below = block.below();
    return !!below && below.typeId === CONFIG.blocks.base;
  } catch (e) {
    return false;
  }
}

/**
 * Terminal authentication — the Sign In screen.
 * Unlike holding a card in your own hand, a machine never trusts you on sight:
 * even the owner enters the PIN, every session.
 */
async function authenticateAtMachine(player, item, isCredit) {
  const read = isCredit ? readCreditData : readCardData;
  const write = isCredit ? writeCreditData : writeCardData;
  const data = read(item);

  if (data.locked) {
    if (data.ownerUuid === player.id) {
      data.locked = false;
      data.attempts = 0;
      write(item, data);
      setMainhandItem(player, item);
      player.sendMessage("§aOwner verified at terminal — lockout cleared. Please enter your PIN.");
    } else {
      failTransaction(player, "sign-in", "This card is locked.");
      return false;
    }
  }

  if (hasMachineSession(player, data.cardUid)) return true;

  const acct = item.getDynamicProperty("account_number") ?? "—";
  const entered = await openKeypad(player, "Sign In", `§7Account §f${acct}§7 · ${data.ownerName}\n§8Enter your PIN to continue.`, {
    length: CONFIG.security.pinLength,
    mask: true,
    confirmLabel: "Change",
    deleteLabel: "Delete",
    showBack: true
  });
  if (!isDigits(entered)) {
    endMachineSession(player);
    return false;
  }

  const fresh = getMainhandItem(player);
  if (!fresh || fresh.getDynamicProperty("card_uid") !== data.cardUid) {
    failTransaction(player, "sign-in", "Card removed from the terminal.");
    endMachineSession(player);
    return false;
  }
  const d2 = read(fresh);

  if (entered === d2.pin) {
    d2.attempts = 0;
    write(fresh, d2);
    setMainhandItem(player, fresh);
    grantMachineSession(player, d2.cardUid);
    return true;
  }

  d2.attempts += 1;
  if (d2.attempts >= CONFIG.security.maxPinFailures) {
    d2.locked = true;
    write(fresh, d2);
    setMainhandItem(player, fresh);
    playLockoutFeedback(player);
    failTransaction(player, "sign-in", "Too many failed attempts — card locked.");
    return false;
  }
  write(fresh, d2);
  setMainhandItem(player, fresh);
  failTransaction(player, "sign-in", `Incorrect PIN. ${CONFIG.security.maxPinFailures - d2.attempts} attempt(s) left.`);
  return false;
}

/* ---- ATM: withdrawals only (debit cash-out, credit cash advance) ---- */

async function handleAtmInteract(player, block) {
  if (!isOnMachineBase(block)) {
    player.sendMessage("§cThis ATM Head needs to be placed on top of an EconomyX Machine Base to function.");
    return;
  }
  const item = getMainhandItem(player);

  if (item && CARD_IDS.includes(item.typeId)) {
    if (item.getDynamicProperty("registered") !== true) {
      player.sendMessage("§cThis card has no account. Sneak + use the card to open one first.");
      return;
    }
    if (!(await authenticateAtMachine(player, item, false))) return;
    const card = requireCard(player);
    if (!card) return;
    const uid = readCardData(card).cardUid;
    if (!captureCard(player, "atm")) return;
    openAtmDenominationMenu(player, uid);
    return;
  }

  if (item && CREDIT_IDS.includes(item.typeId)) {
    if (item.getDynamicProperty("registered") !== true) {
      player.sendMessage("§cThis card has no account. Sneak + use the card to open one first.");
      return;
    }
    if (!(await authenticateAtMachine(player, item, true))) return;
    const card = requireCreditCard(player);
    if (!card) return;
    applyOverdueInterest(player, card);
    setMainhandItem(player, card);
    const fresh = requireCreditCard(player);
    if (!fresh) return;
    const uid = readCreditData(fresh).cardUid;
    if (!captureCard(player, "atm")) return;
    openCreditCashAdvanceMenu(player, uid);
    return;
  }

  player.sendMessage("§cThe ATM needs a Debit or Credit card in your hand.");
}

/** Step 1 of the ATM: the scroll box of denominations from the design. */
async function openAtmDenominationMenu(player, cardUid) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);

  const form = new ActionFormData()
    .title(t("ATM — Withdraw"))
    .body(`§7Balance: §a${formatMoney(data.balance)}\n§8Choose a denomination to withdraw.`);

  for (const typeId of CONFIG.withdrawableItems) {
    const value = CONFIG.values[typeId];
    const maxQty = Math.floor(data.balance / value);
    form.button(`${displayNameFor(typeId)}\n§7${formatMoney(value)} each §8(max ${maxQty})`);
  }
  form.button("§0§l⏏ Eject Card");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openAtmDenominationMenu(player, cardUid));
    return;
  }
  if (res.selection === CONFIG.withdrawableItems.length) return ejectAndClose(player);

  const typeId = CONFIG.withdrawableItems[res.selection];
  if (Math.floor(data.balance / CONFIG.values[typeId]) <= 0) {
    failTransaction(player, "withdrawal", "Your balance will not cover one of those.");
    return openAtmDenominationMenu(player, cardUid);
  }
  return openWithdrawMenu(player, cardUid, typeId);
}

/**
 * Step 2 of the ATM — the keypad screen from the design.
 * Amount readout, digits, Delete, Withdraw, Select All, Eject Card, Back.
 */
async function openWithdrawMenu(player, cardUid, typeId) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  // Reached from a Back button with no denomination chosen yet.
  if (!typeId) return openAtmDenominationMenu(player, cardUid);

  const data = readCardData(item);
  const value = CONFIG.values[typeId];
  const maxQty = Math.floor(data.balance / value);

  const result = await openKeypad(
    player,
    "ATM — Withdraw",
    `§7Balance: §a${formatMoney(data.balance)}\n§7Denomination: §f${displayNameFor(typeId)} §8(${formatMoney(value)})\n§8Max ${maxQty}`,
    {
      length: 9,
      confirmLabel: "Withdraw",
      deleteLabel: "Remove",
      showBack: true,
      extraKeys: ["§b Select All", "§l⏏ Eject Card"]
    }
  );

  if (result === null) {
    reopenOnCancel(player, () => openWithdrawMenu(player, cardUid, typeId));
    return;
  }
  if (result === KEYPAD_BACK) return openAtmDenominationMenu(player, cardUid);

  let qty;
  if (typeof result === "object") {
    if (result.extra === 1) return ejectAndClose(player);
    // Select All takes the largest whole number of this denomination the
    // balance covers. Amex Platinum has no ceiling, so there is nothing to
    // select all of — the design calls for it to do nothing there.
    qty = maxQty;
    if (!Number.isFinite(qty) || qty <= 0) {
      failTransaction(player, "withdrawal", "There is nothing to select.");
      return openWithdrawMenu(player, cardUid, typeId);
    }
  } else {
    qty = parseInt(result, 10);
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    failTransaction(player, "withdrawal", "No amount was entered.");
    return openWithdrawMenu(player, cardUid, typeId);
  }

  const fresh = requireCard(player, cardUid);
  if (!fresh) return;
  const d2 = readCardData(fresh);
  const cost = value * qty;
  if (cost > d2.balance) {
    failTransaction(player, "withdrawal", "That is more than your balance.");
    return openWithdrawMenu(player, cardUid, typeId);
  }

  d2.balance = round2(d2.balance - cost);
  writeCardData(fresh, d2);
  setMainhandItem(player, fresh);
  giveItems(player, typeId, qty);

  playFeedback(player, getTierForColor(colorFromTypeId(fresh.typeId)));
  confirmTransaction(
    player,
    "withdrawal",
    `${qty}x ${displayNameFor(typeId)} (${formatMoney(cost)})`,
    `§7Account balance: §a${formatMoney(d2.balance)}`
  );
  return openWithdrawMenu(player, cardUid, typeId);
}

async function openCreditCashAdvanceMenu(player, cardUid) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);
  const tier = getCreditTier(creditTierFromTypeId(item.typeId));
  const availableCredit = tier.limit === Infinity ? Infinity : tier.limit - data.debt;

  if (availableCredit <= 0) {
    failTransaction(player, "cash advance", "You have no available credit remaining.");
    return openCreditHome(player, cardUid);
  }

  const form = new ActionFormData()
    .title(t("ATM — Cash Advance"))
    .body(
      `§7Debt: §c${formatMoney(data.debt)}\n` +
        `§7Available Credit: §a${tier.limit === Infinity ? "Unlimited" : formatMoney(availableCredit)}\n` +
        `§8Choose a denomination.`
    );

  for (const typeId of CONFIG.withdrawableItems) {
    const value = CONFIG.values[typeId];
    const maxQty = availableCredit === Infinity ? "∞" : Math.floor(availableCredit / value);
    form.button(`${displayNameFor(typeId)}\n§7${formatMoney(value)} each §8(max ${maxQty})`);
  }
  form.button("§0§l⏏ Eject Card");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openCreditCashAdvanceMenu(player, cardUid));
    return;
  }
  if (res.selection === CONFIG.withdrawableItems.length) return ejectAndClose(player);

  return openCreditCashAdvanceAmount(player, cardUid, CONFIG.withdrawableItems[res.selection]);
}

async function openCreditCashAdvanceAmount(player, cardUid, typeId) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);
  const tierKey = creditTierFromTypeId(item.typeId);
  const tier = getCreditTier(tierKey);
  const availableCredit = tier.limit === Infinity ? Infinity : tier.limit - data.debt;
  const value = CONFIG.values[typeId];
  const maxQty = availableCredit === Infinity ? Infinity : Math.floor(availableCredit / value);

  const result = await openKeypad(
    player,
    "ATM — Cash Advance",
    `§7Debt: §c${formatMoney(data.debt)}\n§7Denomination: §f${displayNameFor(typeId)} §8(${formatMoney(value)})\n` +
      `§8Max ${maxQty === Infinity ? "unlimited" : maxQty}`,
    {
      length: 9,
      confirmLabel: "Withdraw",
      deleteLabel: "Remove",
      showBack: true,
      // Unlimited credit has no ceiling, so there is nothing for Select All to
      // total up — the button is simply not offered on an Amex Platinum.
      extraKeys: maxQty === Infinity ? ["§l⏏ Eject Card"] : ["§b Select All", "§l⏏ Eject Card"]
    }
  );

  if (result === null) {
    reopenOnCancel(player, () => openCreditCashAdvanceAmount(player, cardUid, typeId));
    return;
  }
  if (result === KEYPAD_BACK) return openCreditCashAdvanceMenu(player, cardUid);

  let qty;
  if (typeof result === "object") {
    const ejectIndex = maxQty === Infinity ? 0 : 1;
    if (result.extra === ejectIndex) return ejectAndClose(player);
    qty = maxQty;
  } else {
    qty = parseInt(result, 10);
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    failTransaction(player, "cash advance", "No amount was entered.");
    return openCreditCashAdvanceAmount(player, cardUid, typeId);
  }

  const fresh = requireCreditCard(player, cardUid);
  if (!fresh) return;
  const d2 = readCreditData(fresh);
  const cost = value * qty;
  const avail = tier.limit === Infinity ? Infinity : tier.limit - d2.debt;
  if (cost > avail) {
    failTransaction(player, "cash advance", "That exceeds your available credit.");
    return openCreditCashAdvanceAmount(player, cardUid, typeId);
  }

  // Borrowing charges interest immediately, and the rate climbs with how deep
  // in debt the card already is.
  const borrowed = round2(d2.debt + cost);
  let interest = 0;
  if (CONFIG.interest.chargeOnBorrow) {
    const r = chargeInterest(tierKey, borrowed);
    interest = r.interest;
    d2.debt = r.newDebt;
  } else {
    d2.debt = borrowed;
  }
  if (typeof fresh.getDynamicProperty("last_interest_day") !== "number") {
    fresh.setDynamicProperty("last_interest_day", currentDay());
  }
  writeCreditData(fresh, d2);
  setMainhandItem(player, fresh);
  giveItems(player, typeId, qty);

  try {
    player.playSound(tier.useSound);
  } catch (e) {
    /* no-op */
  }
  const rate = effectiveInterestRate(tierKey, borrowed);
  confirmTransaction(
    player,
    "cash advance",
    `${qty}x ${displayNameFor(typeId)} (${formatMoney(cost)})${interest > 0 ? ` + ${formatMoney(interest)} interest @ ${(rate * 100).toFixed(1)}%` : ""}`,
    `§7Outstanding debt: §c${formatMoney(d2.debt)}`
  );
  return openCreditCashAdvanceAmount(player, cardUid, typeId);
}

/* ---- UTM: everything except withdrawal — debit only ---- */

async function handleUtmInteract(player, block) {
  if (!isOnMachineBase(block)) {
    player.sendMessage("§cThis UTM Head needs to be placed on top of an EconomyX Machine Base to function.");
    return;
  }
  const item = getMainhandItem(player);

  if (item && CREDIT_IDS.includes(item.typeId)) {
    failTransaction(player, "sign-in", "The UTM only accepts Debit Cards.");
    return;
  }
  if (!item || !CARD_IDS.includes(item.typeId)) {
    player.sendMessage("§cThe UTM only accepts Debit Cards. Hold your debit card and try again.");
    return;
  }
  if (item.getDynamicProperty("registered") !== true) {
    player.sendMessage("§cThis card has no account. Sneak + use the card to open one first.");
    return;
  }
  if (!(await authenticateAtMachine(player, item, false))) return;
  const card = requireCard(player);
  if (!card) return;
  const uid = readCardData(card).cardUid;
  if (!captureCard(player, "utm")) return;
  openUtmDebitMenu(player, uid);
}

/** UTM home screen: Deposit, Transfer, Eject Card, Setting. */
async function openUtmDebitMenu(player, cardUid) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);
  const tier = getTierForColor(colorFromTypeId(item.typeId));

  const form = new ActionFormData()
    .title(t("UTM — Choose One"))
    .body(
      `§7Account: §f${item.getDynamicProperty("account_number") ?? "—"}\n` +
        `§7Balance: §a${formatMoney(data.balance)}\n` +
        `§7Transfer Limit: §f${formatMoney(tier.transferLimit)}\n\n` +
        `§8Withdrawals are ATM-only.`
    )
    .button("§0§l⬆ Deposit")
    .button("§0§l➤ Transfer")
    .button("§0§l⏏ Eject Card")
    .button("§0§l⚙ Setting");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openUtmDebitMenu(player, cardUid));
    return;
  }
  if (res.selection === 0) return openDepositMenu(player, cardUid);
  if (res.selection === 1) return openTransferMenu(player, cardUid);
  if (res.selection === 2) return ejectAndClose(player); // the ONLY eject
  if (res.selection === 3) return openSecurityMenu(player, cardUid);
}

/** Kept for the Check Balance route and reachable from Setting. */
async function openBalanceInfo(player, cardUid) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);
  const tier = getTierForColor(colorFromTypeId(item.typeId));

  const form = new ActionFormData()
    .title(t("Balance"))
    .body(
      `§7Owner: §f${data.ownerName}\n` +
        `§7Account: §f${item.getDynamicProperty("account_number") ?? "—"}\n` +
        `§7Card: §f${debitCardTitle(item.typeId)}\n\n` +
        `§7Balance: §a${formatMoney(data.balance)}\n` +
        `§7Transfer limit: §f${formatMoney(tier.transferLimit)}\n` +
        `§7Fee: §f${tier.feePercent}%  §7Cashback: §f${tier.cashbackPercent}%`
    )
    .button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openBalanceInfo(player, cardUid));
    return;
  }
  return openUtmDebitMenu(player, cardUid);
}

/**
 * Deposit — step 1: the scroll box of everything in your inventory that is
 * worth something. Step 2 is the keypad.
 */
async function openDepositMenu(player, cardUid) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);

  const available = CONFIG.depositableItems
    .map((typeId) => ({ typeId, count: countItem(player, typeId), value: CONFIG.values[typeId] }))
    .filter((e) => e.count > 0);

  const form = new ActionFormData()
    .title(t("UTM — Deposit"))
    .body(
      available.length
        ? `§7Balance: §a${formatMoney(data.balance)}\n§8Choose what to deposit.`
        : `§7Balance: §a${formatMoney(data.balance)}\n\n§cYou are not carrying anything the bank accepts.`
    );

  for (const e of available) {
    form.button(`${displayNameFor(e.typeId)} §8x${e.count}\n§7${formatMoney(e.value)} each`);
  }
  form.button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openDepositMenu(player, cardUid));
    return;
  }
  if (res.selection === available.length) return openUtmDebitMenu(player, cardUid);

  const chosen = available[res.selection];
  return openDepositAmount(player, cardUid, chosen.typeId);
}

/** Deposit — step 2: keypad, Add All, Deposit, Back. */
async function openDepositAmount(player, cardUid, typeId) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);
  const have = countItem(player, typeId);
  const value = CONFIG.values[typeId];

  if (have <= 0) {
    failTransaction(player, "deposit", "You no longer have any of those.");
    return openDepositMenu(player, cardUid);
  }

  const result = await openKeypad(
    player,
    "UTM — Deposit",
    `§7Balance: §a${formatMoney(data.balance)}\n§7Depositing: §f${displayNameFor(typeId)} §8(${formatMoney(value)} each)\n§8You have ${have}`,
    {
      length: 9,
      confirmLabel: "Deposit",
      deleteLabel: "No",
      showBack: true,
      extraKeys: ["§b Add All"]
    }
  );

  if (result === null) {
    reopenOnCancel(player, () => openDepositAmount(player, cardUid, typeId));
    return;
  }
  if (result === KEYPAD_BACK) return openDepositMenu(player, cardUid);

  let qty;
  if (typeof result === "object") {
    qty = have; // Add All
  } else {
    qty = parseInt(result, 10);
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    failTransaction(player, "deposit", "No amount was entered.");
    return openDepositAmount(player, cardUid, typeId);
  }
  if (qty > countItem(player, typeId)) {
    failTransaction(player, "deposit", "You do not have that many.");
    return openDepositAmount(player, cardUid, typeId);
  }

  // Validate the card before taking anything out of the inventory.
  const fresh = requireCard(player, cardUid);
  if (!fresh) {
    failTransaction(player, "deposit", "Card is no longer in the terminal. Nothing was taken.");
    return;
  }
  const d2 = readCardData(fresh);
  const credited = value * qty;
  if (d2.balance + credited > CONFIG.maxBalance) {
    failTransaction(player, "deposit", "That would push you past the balance ceiling.");
    return openDepositAmount(player, cardUid, typeId);
  }
  if (!removeItems(player, typeId, qty)) {
    failTransaction(player, "deposit", "Could not collect the items.");
    return openDepositAmount(player, cardUid, typeId);
  }

  d2.balance = round2(d2.balance + credited);
  writeCardData(fresh, d2);
  setMainhandItem(player, fresh);

  playFeedback(player, getTierForColor(colorFromTypeId(fresh.typeId)));
  confirmTransaction(
    player,
    "deposit",
    `${qty}x ${displayNameFor(typeId)} (${formatMoney(credited)})`,
    `§7Account balance: §a${formatMoney(d2.balance)}`
  );
  return openDepositAmount(player, cardUid, typeId);
}

/**
 * Transfer — step 1: the scroll box of recipients. Nearby card holders are
 * listed directly; anyone else can be reached by typing a username or an
 * account number, exactly as the design notes describe.
 */
async function openTransferMenu(player, cardUid) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);
  const tier = getTierForColor(colorFromTypeId(item.typeId));

  const nearby = findNearbyCardHolders(player, CONFIG.transfer.defaultRadius);

  const form = new ActionFormData()
    .title(t("UTM — Transfer"))
    .body(
      `§7Balance: §a${formatMoney(data.balance)}\n` +
        `§7Transfer limit: §f${formatMoney(tier.transferLimit)}\n` +
        `§7Fee: §f${tier.feePercent}%\n\n` +
        (nearby.length ? `§8Card holders within ${CONFIG.transfer.defaultRadius} blocks:` : `§8Nobody nearby is holding a card.`)
    );

  for (const p of nearby) form.button(`§f${p.name}`);
  form.button("§0 Type username / account no.");
  form.button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openTransferMenu(player, cardUid));
    return;
  }
  if (res.selection === nearby.length + 1) return openUtmDebitMenu(player, cardUid);

  if (res.selection === nearby.length) {
    const modal = new ModalFormData()
      .title(t("UTM — Transfer"))
      .textField("Username or account number", "Username");
    const r = await modal.show(player);
    if (r.canceled) return openTransferMenu(player, cardUid);
    const query = String(r.formValues[0] ?? "").trim();
    if (!query) {
      failTransaction(player, "transfer", "No recipient entered.");
      return openTransferMenu(player, cardUid);
    }
    const target = resolveRecipient(player, query);
    if (!target) {
      failTransaction(player, "transfer", `No card holder found for "${query}".`);
      return openTransferMenu(player, cardUid);
    }
    return openTransferAmount(player, cardUid, target.name);
  }

  return openTransferAmount(player, cardUid, nearby[res.selection].name);
}

/** Finds a nearby player holding a debit card, by name or by account number. */
function resolveRecipient(player, query) {
  const q = query.toLowerCase();
  for (const p of findNearbyCardHolders(player, CONFIG.transfer.defaultRadius)) {
    if (p.name.toLowerCase() === q) return p;
    const held = getMainhandItem(p);
    const acct = held?.getDynamicProperty("account_number");
    if (acct && String(acct) === query) return p;
  }
  return null;
}

function findNearbyCardHolders(player, radius) {
  const results = [];
  const nearby = player.dimension.getPlayers({ location: player.location, maxDistance: radius });
  for (const p of nearby) {
    if (p.id === player.id) continue;
    const held = getMainhandItem(p);
    if (held && CARD_IDS.includes(held.typeId) && held.getDynamicProperty("registered") === true) {
      results.push(p);
    }
  }
  return results;
}

/** Transfer — step 2: keypad for the amount, then Send. */
async function openTransferAmount(player, cardUid, recipientName) {
  const item = requireCard(player, cardUid);
  if (!item) return;
  const data = readCardData(item);
  const tier = getTierForColor(colorFromTypeId(item.typeId));

  const result = await openKeypad(
    player,
    "UTM — Transfer",
    `§7To: §f${recipientName}\n§7Balance: §a${formatMoney(data.balance)}\n` +
      `§7Limit: §f${formatMoney(tier.transferLimit)} §8· fee ${tier.feePercent}%`,
    {
      length: 9,
      confirmLabel: "Send",
      deleteLabel: "Delete",
      showBack: true
    }
  );

  if (result === null) {
    reopenOnCancel(player, () => openTransferAmount(player, cardUid, recipientName));
    return;
  }
  if (result === KEYPAD_BACK) return openTransferMenu(player, cardUid);

  const amount = parseInt(result, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    failTransaction(player, "transfer", "No amount was entered.");
    return openTransferAmount(player, cardUid, recipientName);
  }
  if (amount > tier.transferLimit) {
    failTransaction(player, "transfer", `Above your ${formatMoney(tier.transferLimit)} transfer limit.`);
    return openTransferAmount(player, cardUid, recipientName);
  }

  const fee = round2(amount * (tier.feePercent / 100));
  const cost = round2(amount + fee);
  const fresh = requireCard(player, cardUid);
  if (!fresh) return;
  const d2 = readCardData(fresh);
  if (cost > d2.balance) {
    failTransaction(player, "transfer", `You need ${formatMoney(cost)} including the ${formatMoney(fee)} fee.`);
    return openTransferAmount(player, cardUid, recipientName);
  }

  const recipient = findNearbyCardHolders(player, CONFIG.transfer.defaultRadius).find((p) => p.name === recipientName);
  if (!recipient) {
    failTransaction(player, "transfer", "Recipient is no longer nearby holding a card.");
    return openTransferMenu(player, cardUid);
  }
  const rItem = getMainhandItem(recipient);
  if (!rItem || !CARD_IDS.includes(rItem.typeId)) {
    failTransaction(player, "transfer", "Recipient must hold a debit card.");
    return openTransferMenu(player, cardUid);
  }

  const rData = readCardData(rItem);
  const rTier = getTierForColor(colorFromTypeId(rItem.typeId));
  const cashback = round2(amount * (rTier.cashbackPercent / 100));

  d2.balance = round2(d2.balance - cost);
  rData.balance = round2(rData.balance + amount + cashback);

  writeCardData(fresh, d2);
  setMainhandItem(player, fresh);
  writeCardData(rItem, rData);
  setMainhandItem(recipient, rItem);

  confirmTransaction(
    player,
    "transfer",
    `${formatMoney(amount)} sent to ${recipient.name}${fee > 0 ? ` §8(+${formatMoney(fee)} fee)` : ""}`,
    `§7Account balance: §a${formatMoney(d2.balance)}`
  );
  confirmTransaction(
    recipient,
    "payment",
    `${formatMoney(amount)} received from ${player.name}${cashback > 0 ? ` §8(+${formatMoney(cashback)} cashback)` : ""}`,
    `§7Account balance: §a${formatMoney(rData.balance)}`
  );
  return openUtmDebitMenu(player, cardUid);
}

/* ---- Settings ---- */

/**
 * The Settings screen. Every route out of here goes Back to the terminal home,
 * never straight out of the UI — that was the bug where pressing Back on
 * Settings dropped you out of the terminal entirely.
 */
async function openSecurityMenu(player, cardUid) {
  const item = requireCard(player, cardUid);
  if (!item) return;

  const form = new ActionFormData()
    .title(t("Settings"))
    .body("§8More settings will be added in the future.")
    .button("§0§l⬤ §rChange Account Number")
    .button("§0§l⬤ §rChange Account Pin")
    .button("§0§l⬤ §rShow Pin")
    .button("§0§l💳 Check Balance")
    .button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openSecurityMenu(player, cardUid));
    return;
  }
  if (res.selection === 0) return openChangeAccountNumber(player, cardUid, false);
  if (res.selection === 1) return openChangePin(player, cardUid, false);
  if (res.selection === 2) return openShowPin(player, cardUid, false);
  if (res.selection === 3) return openBalanceInfo(player, cardUid);
  return openUtmDebitMenu(player, cardUid);
}

async function openShowPin(player, cardUid, isCredit) {
  const item = isCredit ? requireCreditCard(player, cardUid) : requireCard(player, cardUid);
  if (!item) return;
  const data = isCredit ? readCreditData(item) : readCardData(item);

  const form = new ActionFormData()
    .title(t("Show Pin"))
    .body(
      `§7Account: §f${item.getDynamicProperty("account_number") ?? "—"}\n` +
        `§7Owner: §f${data.ownerName}\n\n` +
        `§7PIN: §f§l${data.pin || "—"}\n\n` +
        `§8Only ever shown to the card holder at the terminal.`
    )
    .button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openShowPin(player, cardUid, isCredit));
    return;
  }
  return isCredit ? openCreditSecurityMenu(player, cardUid) : openSecurityMenu(player, cardUid);
}

async function openChangeAccountNumber(player, cardUid, isCredit) {
  const item = isCredit ? requireCreditCard(player, cardUid) : requireCard(player, cardUid);
  if (!item) return;
  const kind = isCredit ? "credit" : "debit";
  const current = item.getDynamicProperty("account_number") ?? "—";
  const len = CONFIG.security.accountNumberLength;

  const result = await openKeypad(player, "Change Account Number", `§7Current: §f${current}\n§8Enter a new ${len}-digit account number.`, {
    length: len,
    confirmLabel: "Change",
    deleteLabel: "Delete",
    showBack: true
  });

  if (result === null) {
    reopenOnCancel(player, () => openChangeAccountNumber(player, cardUid, isCredit));
    return;
  }
  if (result === KEYPAD_BACK) {
    return isCredit ? openCreditSecurityMenu(player, cardUid) : openSecurityMenu(player, cardUid);
  }
  if (result.length !== len) {
    failTransaction(player, "change", `The account number must be exactly ${len} digits.`);
    return openChangeAccountNumber(player, cardUid, isCredit);
  }
  if (result === String(current)) {
    failTransaction(player, "change", "That is already your account number.");
    return openChangeAccountNumber(player, cardUid, isCredit);
  }
  if (!accountAvailable(kind, result)) {
    failTransaction(player, "change", "That account number is already taken.");
    return openChangeAccountNumber(player, cardUid, isCredit);
  }

  const fresh = isCredit ? requireCreditCard(player, cardUid) : requireCard(player, cardUid);
  if (!fresh) return;
  const data = isCredit ? readCreditData(fresh) : readCardData(fresh);

  releaseAccount(kind, String(current));
  claimAccount(kind, result, data.ownerName, data.ownerUuid);
  fresh.setDynamicProperty("account_number", result);
  stampCardLore(fresh, result, kind);
  setMainhandItem(player, fresh);

  confirmTransaction(player, "change", `Account number is now ${result}`, `§7Card: §f${isCredit ? creditCardTitle(fresh.typeId) : debitCardTitle(fresh.typeId)}`);
  player.sendMessage(`§aAccount number changed to §f${result}§a.`);
  return isCredit ? openCreditSecurityMenu(player, cardUid) : openSecurityMenu(player, cardUid);
}

async function openChangePin(player, cardUid, isCredit) {
  const item = isCredit ? requireCreditCard(player, cardUid) : requireCard(player, cardUid);
  if (!item) return;
  const len = CONFIG.security.pinLength;

  const pin1 = await openKeypad(player, "Change Account Pin", `§8Enter a new ${len}-digit PIN.`, {
    length: len,
    mask: true,
    confirmLabel: "Change",
    deleteLabel: "Delete",
    showBack: true
  });
  if (pin1 === null) {
    reopenOnCancel(player, () => openChangePin(player, cardUid, isCredit));
    return;
  }
  if (pin1 === KEYPAD_BACK) {
    return isCredit ? openCreditSecurityMenu(player, cardUid) : openSecurityMenu(player, cardUid);
  }
  if (pin1.length !== len) {
    failTransaction(player, "change", `The PIN must be exactly ${len} digits.`);
    return openChangePin(player, cardUid, isCredit);
  }

  const pin2 = await openKeypad(player, "Change Account Pin", "§8Enter the same PIN again to confirm.", {
    length: len,
    mask: true,
    confirmLabel: "Change",
    deleteLabel: "Delete",
    showBack: true
  });
  if (pin2 === null) {
    reopenOnCancel(player, () => openChangePin(player, cardUid, isCredit));
    return;
  }
  if (pin2 === KEYPAD_BACK) return openChangePin(player, cardUid, isCredit);
  if (pin1 !== pin2) {
    failTransaction(player, "change", "Those PINs did not match.");
    return openChangePin(player, cardUid, isCredit);
  }

  const fresh = isCredit ? requireCreditCard(player, cardUid) : requireCard(player, cardUid);
  if (!fresh) return;
  const data = isCredit ? readCreditData(fresh) : readCardData(fresh);
  data.pin = pin1;
  data.attempts = 0;
  data.locked = false;
  if (isCredit) writeCreditData(fresh, data);
  else writeCardData(fresh, data);
  setMainhandItem(player, fresh);

  confirmTransaction(player, "change", "Your PIN has been updated", "§7Keep it to yourself.");
  player.sendMessage("§aYour PIN has been updated.");
  return isCredit ? openCreditSecurityMenu(player, cardUid) : openSecurityMenu(player, cardUid);
}

/* ---- Debt Payment Block: the only place credit debt is settled ---- */

async function handlePaymentInteract(player, block) {
  if (!isOnMachineBase(block)) {
    player.sendMessage("§cThe Debt Payment Block needs to sit on an EconomyX Machine Base to function.");
    return;
  }
  const item = getMainhandItem(player);
  if (!item || !CREDIT_IDS.includes(item.typeId)) {
    player.sendMessage("§cHold a credit card to pay down debt here.");
    return;
  }
  if (item.getDynamicProperty("registered") !== true) {
    player.sendMessage("§cThis card has no account. Sneak + use the card to open one first.");
    return;
  }
  if (!(await authenticateAtMachine(player, item, true))) return;

  const card = requireCreditCard(player);
  if (!card) return;
  applyOverdueInterest(player, card);
  setMainhandItem(player, card);

  const fresh = requireCreditCard(player);
  if (!fresh) return;
  const data = readCreditData(fresh);
  if (!captureCard(player, "payment")) return;
  openPaymentHome(player, data.cardUid);
}

/** Debt Payment home: the card and its debt, then Pay / Eject card / Settings. */
async function openPaymentHome(player, cardUid) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);
  const tierKey = creditTierFromTypeId(item.typeId);
  const tier = getCreditTier(tierKey);

  const form = new ActionFormData()
    .title(t("Debt Payment"))
    .body(
      `§7Card: §f${creditCardTitle(item.typeId)}\n` +
        `§7Account: §f${item.getDynamicProperty("account_number") ?? "—"}\n` +
        `§7Owner: §f${data.ownerName}\n\n` +
        `§7Outstanding debt: §c${formatMoney(data.debt)}\n` +
        `§7Credit limit: §f${tier.limit === Infinity ? "Unlimited" : formatMoney(tier.limit)}\n` +
        `§7Interest rate: §f${(effectiveInterestRate(tierKey, data.debt) * 100).toFixed(1)}%`
    )
    .button("§0§l⬆ Pay")
    .button("§0§l⏏ Eject card")
    .button("§0§l⚙ Settings");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openPaymentHome(player, cardUid));
    return;
  }
  if (res.selection === 0) {
    if (data.debt <= 0) {
      failTransaction(player, "payment", "This card has no outstanding debt.");
      return openPaymentHome(player, cardUid);
    }
    return openCreditRepayMenu(player, cardUid);
  }
  if (res.selection === 1) return ejectAndClose(player);
  return openCreditSecurityMenu(player, cardUid);
}

async function openCreditSecurityMenu(player, cardUid) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;

  const form = new ActionFormData()
    .title(t("Settings"))
    .body("§8More settings will be added in the future.")
    .button("§0§l⬤ §rChange Account Number")
    .button("§0§l⬤ §rChange Account Pin")
    .button("§0§l⬤ §rShow Pin")
    .button("§0§l💳 Check Debt Status")
    .button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openCreditSecurityMenu(player, cardUid));
    return;
  }
  if (res.selection === 0) return openChangeAccountNumber(player, cardUid, true);
  if (res.selection === 1) return openChangePin(player, cardUid, true);
  if (res.selection === 2) return openShowPin(player, cardUid, true);
  if (res.selection === 3) return openCreditDebtInfo(player, cardUid);
  return terminalHome(player, cardUid);
}

async function openCreditDebtInfo(player, cardUid) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);
  const tierKey = creditTierFromTypeId(item.typeId);
  const tier = getCreditTier(tierKey);
  const available = tier.limit === Infinity ? "Unlimited" : formatMoney(tier.limit - data.debt);

  const form = new ActionFormData()
    .title(t("Debt Status"))
    .body(
      `§7Owner: §f${data.ownerName}\n` +
        `§7Current Debt: §c${formatMoney(data.debt)}\n` +
        `§7Credit Limit: §f${tier.limit === Infinity ? "Unlimited" : formatMoney(tier.limit)}\n` +
        `§7Available Credit: §a${available}\n` +
        `§7Interest rate: §f${(effectiveInterestRate(tierKey, data.debt) * 100).toFixed(1)}%`
    )
    .button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openCreditDebtInfo(player, cardUid));
    return;
  }
  return openCreditSecurityMenu(player, cardUid);
}

async function openCreditRepayMenu(player, cardUid) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);

  const available = CONFIG.repayableItems
    .map((typeId) => ({ typeId, count: countItem(player, typeId), value: CONFIG.values[typeId] }))
    .filter((e) => e.count > 0);

  const form = new ActionFormData()
    .title(t("Debt Payment — Pay"))
    .body(
      available.length
        ? `§7Current Debt: §c${formatMoney(data.debt)}\n§8Choose what to pay with.`
        : `§7Current Debt: §c${formatMoney(data.debt)}\n\n§cYou have no cash or coins on you.`
    );
  for (const e of available) {
    form.button(`${displayNameFor(e.typeId)} §8x${e.count}\n§7${formatMoney(e.value)} each`);
  }
  form.button("§0Back");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openCreditRepayMenu(player, cardUid));
    return;
  }
  if (res.selection === available.length) return openPaymentHome(player, cardUid);

  return openCreditRepayAmount(player, cardUid, available[res.selection].typeId);
}

async function openCreditRepayAmount(player, cardUid, typeId) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);
  const value = CONFIG.values[typeId];
  const have = countItem(player, typeId);
  const needed = Math.ceil(data.debt / value);
  const maxUseful = Math.min(have, Math.max(1, needed));

  const result = await openKeypad(
    player,
    "Debt Payment — Pay",
    `§7Debt: §c${formatMoney(data.debt)}\n§7Paying with: §f${displayNameFor(typeId)} §8(${formatMoney(value)} each)\n§8You have ${have} · ${maxUseful} clears it`,
    {
      length: 9,
      confirmLabel: "Pay",
      deleteLabel: "Delete",
      showBack: true,
      extraKeys: ["§b Pay Max"]
    }
  );

  if (result === null) {
    reopenOnCancel(player, () => openCreditRepayAmount(player, cardUid, typeId));
    return;
  }
  if (result === KEYPAD_BACK) return openCreditRepayMenu(player, cardUid);

  let qty = typeof result === "object" ? maxUseful : parseInt(result, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    failTransaction(player, "payment", "No amount was entered.");
    return openCreditRepayAmount(player, cardUid, typeId);
  }
  if (countItem(player, typeId) < qty) {
    failTransaction(player, "payment", "You no longer have enough of that item.");
    return openCreditRepayAmount(player, cardUid, typeId);
  }

  // Validate the card before consuming the player's cash.
  const fresh = requireCreditCard(player, cardUid);
  if (!fresh) {
    failTransaction(player, "payment", "Card is no longer in the terminal. Nothing was taken.");
    return;
  }
  if (!removeItems(player, typeId, qty)) {
    failTransaction(player, "payment", "Could not collect the items.");
    return openCreditRepayAmount(player, cardUid, typeId);
  }

  const d2 = readCreditData(fresh);
  const tendered = value * qty;
  const paid = Math.min(tendered, d2.debt);
  const change = round2(tendered - paid);
  d2.debt = round2(d2.debt - paid);
  writeCreditData(fresh, d2);
  setMainhandItem(player, fresh);
  // Overpaying should not eat the difference — hand the excess straight back.
  if (change > 0) payOutCash(player, change);

  confirmTransaction(
    player,
    "payment",
    `${formatMoney(paid)} applied${change > 0 ? ` §8(${formatMoney(change)} returned)` : ""}`,
    `§7Outstanding debt: §c${formatMoney(d2.debt)}`
  );
  player.sendMessage(`§aPaid off ${formatMoney(paid)}. Remaining debt: ${formatMoney(d2.debt)}`);

  if (d2.debt <= 0) return openPaymentHome(player, cardUid);
  return openCreditRepayAmount(player, cardUid, typeId);
}

/** Credit home, reachable when a cash advance is refused. */
async function openCreditHome(player, cardUid) {
  const item = requireCreditCard(player, cardUid);
  if (!item) return;
  const data = readCreditData(item);
  const tier = getCreditTier(creditTierFromTypeId(item.typeId));

  const form = new ActionFormData()
    .title(t(creditCardTitle(item.typeId)))
    .body(
      `§7Owner: §f${data.ownerName}\n` +
        `§7Current Debt: §c${formatMoney(data.debt)}\n` +
        `§7Credit Limit: §f${tier.limit === Infinity ? "Unlimited" : formatMoney(tier.limit)}\n\n` +
        `§8Use the Debt Payment Block to settle debt.`
    )
    .button("§0§l💳 Check Debt Status")
    .button("§0§l⚙ Settings")
    .button("§0§l⏏ Eject Card");

  const res = await form.show(player);
  if (res.canceled) {
    reopenOnCancel(player, () => openCreditHome(player, cardUid));
    return;
  }
  if (res.selection === 0) return openCreditDebtInfo(player, cardUid);
  if (res.selection === 1) return openCreditSecurityMenu(player, cardUid);
  return ejectAndClose(player);
}

/* ============================================================
 *  GAMBLING — Lottery and Blackjack
 *
 *  From v2.3 you no longer hold anything to play. The block opens
 *  its UI on an empty hand and you pick the funding source in the
 *  menu: a debit card, a credit card, or the cash in your pockets.
 *
 *  Payout rule, shared by both blocks:
 *    WIN  -> net +winBonus  x stake  (bet 100, win  -> you are +50)
 *    LOSE -> net -(1 + lossPenalty) x stake (bet 150, lose -> -225)
 * ============================================================ */

const SOURCE_LABELS = { debit: "Debit card", credit: "Credit card", cash: "Cash" };

/** The first registered card of a class anywhere in the player's inventory. */
function findCardInInventory(player, ids) {
  const container = player.getComponent("minecraft:inventory").container;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (stack && ids.includes(stack.typeId) && stack.getDynamicProperty("registered") === true) {
      return { slot: i, stack };
    }
  }
  return null;
}

/** Funds backing a source, and whether the player has that source at all. */
function sourceFunds(player, source) {
  if (source === "debit") {
    const found = findCardInInventory(player, CARD_IDS);
    return found ? readCardData(found.stack).balance : null;
  }
  if (source === "credit") {
    const found = findCardInInventory(player, CREDIT_IDS);
    if (!found) return null;
    const tier = getCreditTier(creditTierFromTypeId(found.stack.typeId));
    const debt = readCreditData(found.stack).debt;
    return tier.limit === Infinity ? Number.MAX_SAFE_INTEGER : Math.max(0, tier.limit - debt);
  }
  const cash = cashTotal(player);
  return cash > 0 ? cash : null;
}

/**
 * The biggest bet a source can cover. A loss costs 1.5x the stake, so the cap
 * keeps a losing hand from pushing a balance negative or taking cash that is
 * not physically there.
 */
function maxBetFor(funds) {
  return Math.floor(funds / (1 + CONFIG.gambling.lossPenalty));
}

/** Applies a signed win/loss to whichever source was chosen. */
function settleWager(player, source, net) {
  if (source === "debit") {
    const found = findCardInInventory(player, CARD_IDS);
    if (!found) return null;
    const container = player.getComponent("minecraft:inventory").container;
    const d = readCardData(found.stack);
    d.balance = Math.max(0, round2(d.balance + net));
    writeCardData(found.stack, d);
    container.setItem(found.slot, found.stack);
    return d.balance;
  }
  if (source === "credit") {
    const found = findCardInInventory(player, CREDIT_IDS);
    if (!found) return null;
    const container = player.getComponent("minecraft:inventory").container;
    const d = readCreditData(found.stack);
    const tierKey = creditTierFromTypeId(found.stack.typeId);
    if (net < 0) {
      // A loss is borrowed money, so it lands on the debt and accrues interest.
      const owed = round2(d.debt + Math.abs(net));
      d.debt = CONFIG.interest.chargeOnBorrow ? chargeInterest(tierKey, owed).newDebt : owed;
    } else {
      d.debt = round2(Math.max(0, d.debt - net));
    }
    writeCreditData(found.stack, d);
    container.setItem(found.slot, found.stack);
    return d.debt;
  }
  if (net >= 0) payOutCash(player, net);
  else collectCash(player, Math.abs(net));
  return cashTotal(player);
}

function wagerSummary(player, source) {
  if (!source) return "§8No funding source chosen.";
  const funds = sourceFunds(player, source);
  if (funds === null) {
    return source === "cash"
      ? "§cYou have no cash on you."
      : `§cNo registered ${SOURCE_LABELS[source].toLowerCase()} in your inventory.`;
  }
  if (source === "credit") {
    const found = findCardInInventory(player, CREDIT_IDS);
    const tier = getCreditTier(creditTierFromTypeId(found.stack.typeId));
    return (
      `§7Source: §f${creditCardTitle(found.stack.typeId)} §8(acct ${found.stack.getDynamicProperty("account_number") ?? "—"})\n` +
      `§7Available credit: §a${tier.limit === Infinity ? "Unlimited" : formatMoney(funds)}`
    );
  }
  if (source === "debit") {
    const found = findCardInInventory(player, CARD_IDS);
    return (
      `§7Source: §f${debitCardTitle(found.stack.typeId)} §8(acct ${found.stack.getDynamicProperty("account_number") ?? "—"})\n` +
      `§7Balance: §a${formatMoney(funds)}`
    );
  }
  return `§7Source: §fCash on hand\n§7Total: §a${formatMoney(funds)}`;
}

/** The shared bet screen: keypad, Bet, Delete, three source toggles, Back. */
async function openWagerScreen(player, opts) {
  const { title, headline, source, entry, actionLabel } = opts;
  const funds = source ? sourceFunds(player, source) : null;
  const cap = funds === null ? 0 : maxBetFor(funds);

  const form = new ActionFormData()
    .title(t(title))
    .body(
      `${headline}\n\n` +
        `${wagerSummary(player, source)}\n` +
        (source && funds !== null ? `§7Max bet: §f${formatMoney(cap)}\n` : "") +
        `\n§8[ §f§l${entry || "0"}§r§8 ]  §8Choose one source below.`
    );

  for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) form.button(`§l${d}`);
  form.button("§0§l0");
  form.button("§0Delete");
  form.button(`§a§l${actionLabel}`);
  form.button(`Debit card: ${source === "debit" ? "§aOn" : "§8Off"}`);
  form.button(`Credit card: ${source === "credit" ? "§aOn" : "§8Off"}`);
  form.button(`Cash: ${source === "cash" ? "§aOn" : "§8Off"}`);
  form.button("§0Back");

  const res = await form.show(player);
  if (res.canceled) return { action: "close" };

  const sel = res.selection;
  if (sel <= 8) return { action: "digit", digit: String(sel + 1) };
  if (sel === 9) return { action: "digit", digit: "0" };
  if (sel === 10) return { action: "clear" };
  if (sel === 11) return { action: "go" };
  if (sel === 12) return { action: "source", source: "debit" };
  if (sel === 13) return { action: "source", source: "credit" };
  if (sel === 14) return { action: "source", source: "cash" };
  return { action: "back" };
}

/**
 * Runs the shared bet loop and resolves with { source, bet } once a valid bet is
 * placed, or null if the player backed out.
 */
async function runBetLoop(player, title, headlineFn, actionLabel, state) {
  for (;;) {
    const r = await openWagerScreen(player, {
      title,
      headline: headlineFn(),
      source: state.source,
      entry: state.entry,
      actionLabel
    });

    if (r.action === "close" || r.action === "back") return null;
    if (r.action === "digit") {
      if (state.entry.length < 9) state.entry += r.digit;
      continue;
    }
    if (r.action === "clear") {
      state.entry = "";
      continue;
    }
    if (r.action === "source") {
      // "Choose One" — turning one on turns the others off.
      state.source = state.source === r.source ? null : r.source;
      continue;
    }

    // Bet pressed.
    if (!state.source) {
      failTransaction(player, "bet", "Choose a funding source first.");
      continue;
    }
    const funds = sourceFunds(player, state.source);
    if (funds === null) {
      failTransaction(player, "bet", "That funding source is not available.");
      state.source = null;
      continue;
    }
    const bet = parseInt(state.entry, 10);
    if (!Number.isFinite(bet) || bet <= 0) {
      failTransaction(player, "bet", "Enter a bet amount first.");
      continue;
    }
    const cap = maxBetFor(funds);
    if (bet > cap) {
      failTransaction(
        player,
        "bet",
        `Max bet is ${formatMoney(cap)} — a loss costs ${1 + CONFIG.gambling.lossPenalty}x your stake.`
      );
      continue;
    }
    return { source: state.source, bet };
  }
}

/* ---- Lottery ---- */

async function handleLotteryInteract(player, block) {
  const state = { source: null, entry: "", last: "" };

  for (;;) {
    const placed = await runBetLoop(
      player,
      "Lottery",
      () =>
        `§6§lLottery\n§8Win pays your stake +${CONFIG.gambling.winBonus * 100}%. ` +
        `A loss costs your stake +${CONFIG.gambling.lossPenalty * 100}%.` +
        (state.last ? `\n\n§7You Got: ${state.last}` : ""),
      "Bet",
      state
    );
    if (!placed) return;

    const { source, bet } = placed;
    const won = Math.random() < CONFIG.gambling.lotteryWinChance;
    const net = won ? round2(bet * CONFIG.gambling.winBonus) : -round2(bet * (1 + CONFIG.gambling.lossPenalty));

    settleWager(player, source, net);
    state.entry = "";
    state.last = won
      ? `§a${CONFIG.lottery.winMultiplier}x §7(+${formatMoney(net)})`
      : `§cNothing §7(${formatMoney(net)})`;

    player.sendMessage(
      won
        ? `§6[Lottery] §aYou won! §f${formatMoney(bet)} §astake returned with ${formatMoney(net)} on top.`
        : `§6[Lottery] §cYou lost §f${formatMoney(Math.abs(net))}§c — your ${formatMoney(bet)} stake plus ${formatMoney(round2(bet * CONFIG.gambling.lossPenalty))}.`
    );
    try {
      player.playSound(won ? "ex.card_insert" : "note.bass");
    } catch (e) {
      /* no-op */
    }
    try {
      block.dimension.spawnParticle(won ? "minecraft:totem_particle" : "minecraft:villager_angry", block.location);
    } catch (e) {
      /* no-op */
    }
  }
}

/* ---- Blackjack ---- */

function drawCard() {
  return 1 + Math.floor(Math.random() * 10); // 1..10
}

async function handleBlackjackInteract(player, block) {
  const state = { source: null, entry: "", last: "" };

  for (;;) {
    const placed = await runBetLoop(
      player,
      "Blackjack",
      () =>
        `§6§lBlackjack\n§8Beat the dealer without passing ${CONFIG.blackjack.bust}. ` +
        `Win pays +${CONFIG.gambling.winBonus * 100}%, a loss costs +${CONFIG.gambling.lossPenalty * 100}%.` +
        (state.last ? `\n\n§7Last hand: ${state.last}` : ""),
      "Bet",
      state
    );
    if (!placed) return;

    state.entry = "";
    const outcome = await playBlackjackHand(player, placed.source, placed.bet);
    if (outcome) state.last = outcome;
  }
}

/** One hand: Double / Hit / Stand, then the dealer plays and we settle. */
async function playBlackjackHand(player, source, bet) {
  let total = drawCard() + drawCard();
  const dealerUp = drawCard();
  let stake = bet;
  let doubled = false;
  let firstDecision = true;

  for (;;) {
    if (total > CONFIG.blackjack.bust) break;

    const form = new ActionFormData()
      .title(t("Blackjack"))
      .body(
        `§7Dealer's Value: §f${dealerUp} §8(showing)\n` +
          `§7Your Value: §f§l${total}\n\n` +
          `§7Stake: §f${formatMoney(stake)}${doubled ? " §8(doubled)" : ""}\n` +
          `§8Get as close to ${CONFIG.blackjack.bust} as you can without going over.`
      );

    // Double is only offered on the opening hand, as at a real table — once you
    // have taken a card the option is gone.
    const canDouble = firstDecision && !doubled;
    if (canDouble) form.button("§0§lDouble");
    form.button("§0§lHit");
    form.button("§0§lStand");

    const res = await form.show(player);
    if (res.canceled) break; // closing the form stands on what you have

    const sel = res.selection;
    const offset = canDouble ? 0 : 1;
    const choice = sel + offset; // 0 = double, 1 = hit, 2 = stand

    if (choice === 0) {
      const funds = sourceFunds(player, source);
      if (funds === null || maxBetFor(funds) < stake * 2) {
        failTransaction(player, "double", "Not enough funds to double this stake.");
        continue;
      }
      stake = stake * 2;
      doubled = true;
      total += drawCard();
      break; // doubling takes exactly one card, then stands
    }
    if (choice === 1) {
      total += drawCard();
      firstDecision = false;
      continue;
    }
    break; // stand
  }

  const playerBusted = total > CONFIG.blackjack.bust;
  let dealerTotal = dealerUp + drawCard();
  if (!playerBusted) {
    while (dealerTotal < CONFIG.blackjack.dealerStandsOn) dealerTotal += drawCard();
  }
  const dealerBusted = dealerTotal > CONFIG.blackjack.bust;
  const won = !playerBusted && (dealerBusted || total > dealerTotal);
  const push = !playerBusted && !dealerBusted && total === dealerTotal;

  let net = 0;
  if (!push) {
    net = won ? round2(stake * CONFIG.gambling.winBonus) : -round2(stake * (1 + CONFIG.gambling.lossPenalty));
    settleWager(player, source, net);
  }

  const summary = playerBusted
    ? `§cYou busted at ${total}`
    : `§7You ${total} §8vs §7Dealer ${dealerTotal}${dealerBusted ? " §c(bust)" : ""}`;

  const form = new ActionFormData()
    .title(t("Blackjack"))
    .body(
      `${summary}\n\n` +
        (push
          ? "§ePush — your stake is returned."
          : won
            ? `§aYou won ${formatMoney(net)} on a ${formatMoney(stake)} stake.`
            : `§cYou lost ${formatMoney(Math.abs(net))} — your ${formatMoney(stake)} stake plus ${formatMoney(round2(stake * CONFIG.gambling.lossPenalty))}.`)
    )
    .button("§0Back");
  await form.show(player);

  player.sendMessage(
    `§6[Blackjack] ${summary} §8· ` +
      (push ? "§epush" : won ? `§awon ${formatMoney(net)}` : `§clost ${formatMoney(Math.abs(net))}`)
  );
  try {
    player.playSound(won ? "ex.card_insert" : push ? "random.orb" : "note.bass");
  } catch (e) {
    /* no-op */
  }

  return push ? "§ePush" : won ? `§aWon ${formatMoney(net)}` : `§cLost ${formatMoney(Math.abs(net))}`;
}

/* ------------------------------------------------------------
 *  Machine protection and the EX Tool
 * ---------------------------------------------------------- */

const MACHINE_BLOCK_IDS = [
  CONFIG.blocks.base,
  CONFIG.blocks.atm,
  CONFIG.blocks.payment,
  CONFIG.blocks.utm,
  CONFIG.blocks.lottery,
  CONFIG.blocks.blackjack
];

/** Sneak + tap with the EX Tool: dismantle a machine straight into the bag. */
function tryPickaxeHarvest(player, block) {
  try {
    if (!player.isSneaking) return false;
    const held = getHandItemRaw(player);
    if (!held || held.typeId !== "ex:ex_tool") return false;
    if (!MACHINE_BLOCK_IDS.includes(block.typeId)) return false;

    const typeId = block.typeId;
    const loc = { x: block.location.x, y: block.location.y, z: block.location.z };
    system.run(() => {
      try {
        const b = player.dimension.getBlock(loc);
        if (!b || b.typeId !== typeId) return;
        b.setType("minecraft:air");
        const drop = new ItemStack(typeId, 1);
        const inv = player.getComponent("minecraft:inventory").container;
        const leftover = inv.addItem(drop);
        if (leftover) player.dimension.spawnItem(leftover, player.location);
        try {
          player.playSound("random.break");
        } catch (e) {
          /* no-op */
        }
        actionBar(player, "§aMachine dismantled");
        holdActionBar(player, 30);
      } catch (e) {
        console.warn(`[EconomyX] pickaxe harvest: ${e}`);
      }
    });
    return true;
  } catch (err) {
    console.warn(`[EconomyX] pickaxe: ${err}`);
    return false;
  }
}

/**
 * On touch a tap on a block registers as a BREAK, not an interact, so both the
 * break guard and playerInteractWithBlock can fire for one tap. This keeps a
 * single tap from opening a terminal twice.
 */
const lastOpen = new Map();
function debounceOpen(player) {
  const now = system.currentTick;
  const prev = lastOpen.get(player.id);
  if (prev !== undefined && now - prev < 10) return false;
  lastOpen.set(player.id, now);
  return true;
}

/** Routes a tap on a machine into the right handler. */
function routeMachine(player, block) {
  if (!debounceOpen(player)) return;
  const typeId = block.typeId;
  let p;
  if (typeId === CONFIG.blocks.atm) p = handleAtmInteract(player, block);
  else if (typeId === CONFIG.blocks.utm) p = handleUtmInteract(player, block);
  else if (typeId === CONFIG.blocks.payment) p = handlePaymentInteract(player, block);
  else if (typeId === CONFIG.blocks.lottery) p = handleLotteryInteract(player, block);
  else if (typeId === CONFIG.blocks.blackjack) p = handleBlackjackInteract(player, block);
  else {
    // The Machine Base has no screen of its own, so a cancelled break here
    // would otherwise be silent. Say why nothing happened.
    actionBar(player, "§eOnly the EX Tool can dismantle this machine");
    holdActionBar(player, 30);
    return;
  }
  if (p && typeof p.catch === "function") p.catch((e) => console.warn(`[EconomyX] machine handler: ${e}`));
}

/* ------------------------------------------------------------
 *  Event wiring
 *  Every subscription and handler is individually guarded. A thrown
 *  error inside one handler must never propagate into the engine or
 *  stop the rest of the pack from loading.
 * ---------------------------------------------------------- */

function safeSubscribe(label, subscribeFn) {
  try {
    subscribeFn();
  } catch (err) {
    console.warn(`[EconomyX] failed to subscribe '${label}': ${err}`);
  }
}

safeSubscribe("playerBreakBlockGuard", () => {
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    try {
      const { player, block } = event;
      if (!MACHINE_BLOCK_IDS.includes(block.typeId)) return;

      const held = getHandItemRaw(player);
      const heldId = held?.typeId;

      // The EX Tool is the ONLY thing that can dismantle a machine, in
      // creative and survival alike.
      if (heldId === "ex:ex_tool") {
        if (player.isSneaking && tryPickaxeHarvest(player, block)) event.cancel = true;
        return;
      }

      event.cancel = true;

      // On touch a tap registers as a break, so route it into the machine.
      // From v2.3 this happens whatever is (or is not) in the player's hand:
      // the gambling blocks are played with an empty hand, and the banking
      // machines still check for a card themselves.
      const loc = { x: block.location.x, y: block.location.y, z: block.location.z };
      system.run(() => {
        try {
          const b = player.dimension.getBlock(loc);
          if (!b) return;
          routeMachine(player, b);
        } catch (e) {
          console.warn(`[EconomyX] tap route: ${e}`);
        }
      });
    } catch (err) {
      console.warn(`[EconomyX] break guard: ${err}`);
    }
  });
});

safeSubscribe("itemUse", () => {
  world.afterEvents.itemUse.subscribe((event) => {
    try {
      const player = event.source;
      if (!player || player.typeId !== "minecraft:player") return;
      const typeId = event.itemStack?.typeId;
      if (!typeId) return;

      if (CARD_IDS.includes(typeId)) {
        system.run(() => {
          try {
            handleCardUse(player);
          } catch (e) {
            console.warn(`[EconomyX] card use: ${e}`);
          }
        });
      } else if (CREDIT_IDS.includes(typeId)) {
        system.run(() => {
          try {
            handleCreditCardUse(player);
          } catch (e) {
            console.warn(`[EconomyX] credit card use: ${e}`);
          }
        });
      }
    } catch (err) {
      console.warn(`[EconomyX] itemUse handler: ${err}`);
    }
  });
});

safeSubscribe("playerInteractWithBlock", () => {
  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block } = event;
    try {
      if (!MACHINE_BLOCK_IDS.includes(block.typeId)) return;
      if (tryPickaxeHarvest(player, block)) return;
      system.run(() => {
        try {
          routeMachine(player, block);
        } catch (e) {
          console.warn(`[EconomyX] block handler: ${e}`);
        }
      });
    } catch (err) {
      console.warn(`[EconomyX] block interact error: ${err}`);
    }
  });
});

safeSubscribe("playerLeaveSessionClear", () => {
  world.afterEvents.playerLeave.subscribe((event) => {
    try {
      machineSessions.delete(event.playerId);
      actionBarHold.delete(event.playerId);
      lastOpen.delete(event.playerId);

      // The player object is already gone, so the card cannot be handed back
      // here. Park it in world storage and return it when they next spawn —
      // otherwise a logout inside a terminal destroys a registered card.
      const stranded = heldCards.get(event.playerId);
      if (stranded) {
        heldCards.delete(event.playerId);
        try {
          const map = loadStranded();
          map[event.playerId] = serializeCard(stranded.stack);
          saveStranded(map);
          console.warn(`[EconomyX] parked stranded card for ${event.playerName ?? event.playerId}`);
        } catch (e) {
          console.warn(`[EconomyX] could not park stranded card: ${e}`);
        }
      }
    } catch (err) {
      console.warn(`[EconomyX] session clear: ${err}`);
    }
  });
});

safeSubscribe("playerSpawnReturnCard", () => {
  world.afterEvents.playerSpawn.subscribe((event) => {
    try {
      if (!event.initialSpawn) return;
      const player = event.player;
      const map = loadStranded();
      const parked = map[player.id];
      if (!parked) return;
      delete map[player.id];
      saveStranded(map);

      system.runTimeout(() => {
        try {
          const stack = deserializeCard(parked);
          const inv = player.getComponent("minecraft:inventory").container;
          const leftover = inv.addItem(stack);
          if (leftover) player.dimension.spawnItem(leftover, player.location);
          player.sendMessage("§a[EconomyX] Your card was still in a terminal when you left. It has been returned.");
        } catch (e) {
          console.warn(`[EconomyX] returning stranded card: ${e}`);
        }
      }, 40);
    } catch (err) {
      console.warn(`[EconomyX] stranded card restore: ${err}`);
    }
  });
});

safeSubscribe("statusTicker", () => {
  system.runInterval(() => {
    try {
      for (const player of world.getAllPlayers()) {
        try {
          // A captured card keeps its session alive indefinitely. Only the
          // Eject button (or logging out) hands it back — never a timeout.
          if (heldCards.has(player.id)) {
            const s = machineSessions.get(player.id);
            if (s) s.expiresTick = system.currentTick + CONFIG.machineSession.timeoutTicks;
          }
          if (!player.isSneaking) continue;
          if (isActionBarHeld(player)) continue;
          const item = getMainhandItem(player);
          if (!item) continue;

          if (CARD_IDS.includes(item.typeId) && item.getDynamicProperty("registered") === true) {
            const balance = item.getDynamicProperty("card_balance") ?? 0;
            const tier = getTierForColor(colorFromTypeId(item.typeId));
            player.onScreenDisplay.setActionBar(
              `§2Balance: §a${formatMoney(balance)} §7| Limit: §f${formatMoney(tier.transferLimit)}`
            );
          } else if (CREDIT_IDS.includes(item.typeId) && item.getDynamicProperty("registered") === true) {
            const debt = item.getDynamicProperty("card_debt") ?? 0;
            const ctier = getCreditTier(creditTierFromTypeId(item.typeId));
            const limitTxt = ctier.limit === Infinity ? "Unlimited" : formatMoney(ctier.limit);
            player.onScreenDisplay.setActionBar(`§4Debt: §c${formatMoney(debt)} §7| Limit: §f${limitTxt}`);
          }
        } catch (e) {
          /* skip this player, keep the loop alive */
        }
      }
    } catch (err) {
      console.warn(`[EconomyX] status ticker: ${err}`);
    }
  }, 10);
});

/* ------------------------------------------------------------
 *  Phones, the village dealer, and the EX Book
 *
 *  Runs LAST, on purpose. Every binding handed over below is fully
 *  initialised by this point in the file, so phones.js can rely on
 *  all of it without importing main.js back and risking a temporal
 *  dead zone on these consts.
 * ---------------------------------------------------------- */

initPhones({
  // UI
  t,
  openKeypad,
  isDigits,
  debounceOpen,
  safeSubscribe,
  // card identity
  CARD_IDS,
  CREDIT_IDS,
  findCardInInventory,
  creditTierFromTypeId,
  getCreditTier,
  // card state
  readCardData,
  writeCardData,
  readCreditData,
  writeCreditData,
  chargeInterest,
  // cash
  cashTotal,
  collectCash,
  payOutCash,
  // feedback
  actionBar,
  holdActionBar,
  confirmTransaction,
  failTransaction,
  round2
});
