/**
 * ============================================================
 *  EconomyX — phones, the dealer who sells them, and the EX Book
 * ============================================================
 *  WHY THIS IS A CUSTOM ENTITY AND NOT A VANILLA TRADE TABLE
 *  A vanilla villager trade can only swap item for item. It cannot read a
 *  card's balance, cannot ask for a PIN, and cannot make change. Every one
 *  of those is required here, so the dealer is a custom entity whose
 *  interaction opens the same kind of scripted form the ATM and UTM use.
 *  The upside is that buying a phone reuses the bank you already have.
 * ------------------------------------------------------------
 *  WIRING
 *  This module exports one function. main.js calls it at the very bottom of
 *  its own body and hands over the banking helpers it owns. That ordering is
 *  deliberate: it keeps main.js the single owner of card state, and it means
 *  nothing here dereferences a main.js binding before main.js has finished
 *  initialising. Do not convert this into a circular `import` from main.js.
 * ============================================================
 */

import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { CONFIG, formatMoney } from "./config.js";
import { PHONES, PHONE_BY_ID, PHONE_IDS, PHONE_PRICE } from "./phone_data.js";

const DEALER_ID = "ex:phone_dealer";
const BOOK_ID = "ex:ex_book";

/* ---- Dealer placement tuning ---- */
const SPAWN_SCAN_RATE = 200; // ticks between village scans (10 seconds)
const VILLAGE_SCAN_RADIUS = 48; // how far from a player we look for a village
const DEALER_SPACING = 64; // never place a second dealer this close to another
/**
 * How many vanilla villagers count as "a village". Any villager variant is
 * accepted — plains, desert, taiga, savanna, jungle, snowy, swamp alike — so
 * every village type gets a dealer. Two is a light guard so that one villager
 * a player shipped somewhere in a boat does not conjure a shop.
 */
const VILLAGE_MIN_VILLAGERS = 2;
const VILLAGER_TYPES = ["minecraft:villager_v2", "minecraft:villager"];

/* ---- Stock tuning ---- */
const STOCK_MIN = 4;
const STOCK_MAX = 6;
const RESTOCK_DAYS = 3; // in-game days before a dealer refreshes its shelf

const PROP_STOCK = "ex:stock";
const PROP_RESTOCK_DAY = "ex:restock_day";
const BOOK_GRANTED_KEY = "ex:book_granted";

/* ---- On-screen phone display ----
 * No JSON-UI binding reports what a player is holding, so the screen overlay in
 * RP/ui/hud_screen.json is driven by an invisible title instead: four colour
 * codes and no glyphs, which renders as nothing but is still readable by the
 * #hud_title_text_string binding.
 *
 * MUST match the string in RP/ui/hud_screen.json exactly. It deliberately does
 * not contain "§8§r" (UI_TAG, the marker ui/server_form.json watches for), so
 * the phone overlay and the form skin can never trigger one another.
 */
const HUD_TAG = "§9§r§a§r";
const HUD_RATE = 20; // ticks between refreshes
const HUD_STAY = 45; // title lifetime, comfortably longer than HUD_RATE
const PHONE_ID_SET = new Set(PHONE_IDS);
/** playerId -> is the overlay currently up, so we only clear on the transition. */
const hudShown = new Map();

/** Everything main.js lends us. Populated by initPhones(). */
let api = null;

/* ------------------------------------------------------------
 *  Small local helpers
 * ---------------------------------------------------------- */

function alive(e) {
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid;
  } catch {
    return false;
  }
}

function currentDay() {
  try {
    return Math.floor(world.getAbsoluteTime() / 24000);
  } catch {
    return 0;
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Puts an item in the player's hands, falling back to the floor if full. */
function deliver(player, typeId) {
  const stack = new ItemStack(typeId, 1);
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    const leftover = inv.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
    return true;
  } catch (err) {
    console.warn(`[EconomyX] phone delivery: ${err}`);
    try {
      player.dimension.spawnItem(stack, player.location);
      return true;
    } catch {
      return false;
    }
  }
}

/** Celebration at the counter — sound plus particles, purely cosmetic. */
function celebrate(dealer, player, sound) {
  try {
    player.playSound(sound);
  } catch {
    /* no-op */
  }
  try {
    dealer.dimension.spawnParticle("minecraft:totem_particle", {
      x: dealer.location.x,
      y: dealer.location.y + 1.2,
      z: dealer.location.z
    });
  } catch {
    /* no-op */
  }
}

/* ------------------------------------------------------------
 *  Dealer stock
 *  Held as a JSON id list on the entity itself, so two dealers in
 *  two villages keep genuinely separate shelves.
 * ---------------------------------------------------------- */

function rollStock() {
  const pool = PHONES.map((p) => p.id);
  const size = STOCK_MIN + Math.floor(Math.random() * (STOCK_MAX - STOCK_MIN + 1));
  const out = [];
  for (let i = 0; i < size && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

function writeStock(dealer, ids, day) {
  try {
    dealer.setDynamicProperty(PROP_STOCK, JSON.stringify(ids));
    if (typeof day === "number") dealer.setDynamicProperty(PROP_RESTOCK_DAY, day);
  } catch (err) {
    console.warn(`[EconomyX] dealer stock write: ${err}`);
  }
}

/**
 * Current stock, restocking lazily if enough in-game days have passed.
 * Lazy is deliberate: it costs nothing while nobody is shopping, exactly
 * like the way credit interest accrues on this pack's cards.
 */
function readStock(dealer) {
  let ids = [];
  try {
    const raw = dealer.getDynamicProperty(PROP_STOCK);
    if (typeof raw === "string") ids = JSON.parse(raw);
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids)) ids = [];

  const today = currentDay();
  let last = dealer.getDynamicProperty(PROP_RESTOCK_DAY);
  if (typeof last !== "number" || last > today) {
    // A fresh dealer, or a world reloaded backwards in time.
    last = today;
    if (!ids.length) ids = rollStock();
    writeStock(dealer, ids, last);
    return ids;
  }
  if (today - last >= RESTOCK_DAYS) {
    ids = rollStock();
    writeStock(dealer, ids, today);
  }
  // Drop any id that is no longer in the catalogue, so an old save cannot
  // offer a phone this pack has since removed.
  const filtered = ids.filter((id) => PHONE_BY_ID.has(id));
  if (filtered.length !== ids.length) writeStock(dealer, filtered);
  return filtered;
}

function removeFromStock(dealer, id) {
  const ids = readStock(dealer).filter((x) => x !== id);
  writeStock(dealer, ids);
  return ids;
}

/* ------------------------------------------------------------
 *  Village detection and dealer placement
 *
 *  Any villager variant counts. We look for a small cluster of vanilla
 *  villagers near a player, and if no dealer is already serving that
 *  area, we place one. The "is a dealer already nearby" test is what
 *  keeps this idempotent — no bookkeeping to go stale, and it heals
 *  itself if a dealer is ever lost.
 * ---------------------------------------------------------- */

function villagersNear(dimension, location, radius) {
  let found = [];
  for (const type of VILLAGER_TYPES) {
    try {
      found = found.concat(dimension.getEntities({ type, location, maxDistance: radius }));
    } catch {
      /* that villager id does not exist on this version — try the next */
    }
  }
  return found;
}

function dealerNear(dimension, location, radius) {
  try {
    return dimension.getEntities({ type: DEALER_ID, location, maxDistance: radius }).length > 0;
  } catch {
    return false;
  }
}

function trySpawnDealerFor(player) {
  const dim = player.dimension;
  const here = player.location;

  const villagers = villagersNear(dim, here, VILLAGE_SCAN_RADIUS);
  if (villagers.length < VILLAGE_MIN_VILLAGERS) return;

  // Anchor on a villager rather than on the player, so the dealer appears in
  // the village itself and not wherever the player happens to be standing.
  const anchor = pick(villagers);
  if (!alive(anchor)) return;
  if (dealerNear(dim, anchor.location, DEALER_SPACING)) return;

  try {
    const dealer = dim.spawnEntity(DEALER_ID, {
      x: anchor.location.x,
      y: anchor.location.y,
      z: anchor.location.z
    });
    writeStock(dealer, rollStock(), currentDay());
    try {
      dealer.nameTag = "§5EX Phone Dealer";
    } catch {
      /* no-op */
    }
    console.warn(`[EconomyX] phone dealer placed near ${Math.round(anchor.location.x)}, ${Math.round(anchor.location.z)}`);
  } catch (err) {
    console.warn(`[EconomyX] dealer spawn: ${err}`);
  }
}

/* ------------------------------------------------------------
 *  Payment
 * ---------------------------------------------------------- */

/**
 * Asks for a PIN and checks it against the card, applying the same lockout
 * rule the terminals use. Returns true only on a correct PIN.
 */
async function verifyPin(player, found, isCredit) {
  const { openKeypad, isDigits, readCardData, readCreditData, writeCardData, writeCreditData, failTransaction } = api;
  const read = isCredit ? readCreditData : readCardData;
  const write = isCredit ? writeCreditData : writeCardData;
  const container = player.getComponent("minecraft:inventory").container;

  const data = read(found.stack);
  if (data.locked) {
    failTransaction(player, "purchase", "That card is locked. Sneak + use it as the owner to clear it.");
    return false;
  }

  const acct = found.stack.getDynamicProperty("account_number") ?? "—";
  const entered = await openKeypad(
    player,
    "Phone Dealer — PIN",
    `§7Account §f${acct}§7 · ${data.ownerName}\n§8Enter your PIN to authorise ${formatMoney(PHONE_PRICE)}.`,
    {
      length: CONFIG.security.pinLength,
      mask: true,
      confirmLabel: "Confirm",
      deleteLabel: "Delete",
      showBack: true
    }
  );
  if (!isDigits(entered)) return false;

  // Re-read the card: it may have moved or been swapped while the pad was open.
  const fresh = container.getItem(found.slot);
  if (!fresh || fresh.getDynamicProperty("card_uid") !== data.cardUid) {
    failTransaction(player, "purchase", "That card is no longer in your inventory.");
    return false;
  }
  const d2 = read(fresh);

  if (entered === d2.pin) {
    d2.attempts = 0;
    write(fresh, d2);
    container.setItem(found.slot, fresh);
    found.stack = fresh;
    return true;
  }

  d2.attempts += 1;
  if (d2.attempts >= CONFIG.security.maxPinFailures) {
    d2.locked = true;
    write(fresh, d2);
    container.setItem(found.slot, fresh);
    failTransaction(player, "purchase", "Too many failed attempts — card locked.");
    return false;
  }
  write(fresh, d2);
  container.setItem(found.slot, fresh);
  failTransaction(player, "purchase", `Incorrect PIN. ${CONFIG.security.maxPinFailures - d2.attempts} attempt(s) left.`);
  return false;
}

/** Debit: straight deduction, PIN required. Returns true if paid. */
async function payByDebit(player) {
  const { findCardInInventory, CARD_IDS, readCardData, writeCardData, failTransaction, round2 } = api;
  const found = findCardInInventory(player, CARD_IDS);
  if (!found) {
    failTransaction(player, "purchase", "No registered debit card in your inventory.");
    return false;
  }
  if (readCardData(found.stack).balance < PHONE_PRICE) {
    failTransaction(
      player,
      "purchase",
      `That card holds ${formatMoney(readCardData(found.stack).balance)} — you need ${formatMoney(PHONE_PRICE)}.`
    );
    return false;
  }
  if (!(await verifyPin(player, found, false))) return false;

  const container = player.getComponent("minecraft:inventory").container;
  const stack = container.getItem(found.slot);
  if (!stack) return false;
  const d = readCardData(stack);
  if (d.balance < PHONE_PRICE) {
    failTransaction(player, "purchase", "Balance changed — nothing was taken.");
    return false;
  }
  d.balance = round2(d.balance - PHONE_PRICE);
  writeCardData(stack, d);
  container.setItem(found.slot, stack);
  player.sendMessage(`§a[EconomyX] ${formatMoney(PHONE_PRICE)} paid. Balance: ${formatMoney(d.balance)}`);
  return true;
}

/** Credit: borrows the price, charging interest on the borrow like a cash advance. */
async function payByCredit(player) {
  const {
    findCardInInventory,
    CREDIT_IDS,
    readCreditData,
    writeCreditData,
    creditTierFromTypeId,
    getCreditTier,
    chargeInterest,
    failTransaction,
    round2
  } = api;
  const found = findCardInInventory(player, CREDIT_IDS);
  if (!found) {
    failTransaction(player, "purchase", "No registered credit card in your inventory.");
    return false;
  }
  const tierKey = creditTierFromTypeId(found.stack.typeId);
  const tier = getCreditTier(tierKey);
  const debt = readCreditData(found.stack).debt;
  const availableCredit = tier.limit === Infinity ? Infinity : tier.limit - debt;
  if (availableCredit < PHONE_PRICE) {
    failTransaction(player, "purchase", `Only ${formatMoney(availableCredit)} of credit left.`);
    return false;
  }
  if (!(await verifyPin(player, found, true))) return false;

  const container = player.getComponent("minecraft:inventory").container;
  const stack = container.getItem(found.slot);
  if (!stack) return false;
  const d = readCreditData(stack);
  const avail = tier.limit === Infinity ? Infinity : tier.limit - d.debt;
  if (avail < PHONE_PRICE) {
    failTransaction(player, "purchase", "Available credit changed — nothing was borrowed.");
    return false;
  }

  const borrowed = round2(d.debt + PHONE_PRICE);
  const res = CONFIG.interest.chargeOnBorrow ? chargeInterest(tierKey, borrowed) : { interest: 0, newDebt: borrowed };
  d.debt = res.newDebt;
  writeCreditData(stack, d);
  if (typeof stack.getDynamicProperty("last_interest_day") !== "number") {
    stack.setDynamicProperty("last_interest_day", currentDay());
  }
  container.setItem(found.slot, stack);
  player.sendMessage(
    `§c[EconomyX] ${formatMoney(PHONE_PRICE)} borrowed` +
      (res.interest > 0 ? ` §8(+${formatMoney(res.interest)} interest)` : "") +
      `§c. Debt: ${formatMoney(d.debt)}`
  );
  return true;
}

/** Cash: takes notes largest-first and hands back change automatically. */
function payByCash(player) {
  const { cashTotal, collectCash, failTransaction } = api;
  const held = cashTotal(player);
  if (held < PHONE_PRICE) {
    failTransaction(player, "purchase", `You are carrying ${formatMoney(held)} — you need ${formatMoney(PHONE_PRICE)}.`);
    return false;
  }
  if (!collectCash(player, PHONE_PRICE)) {
    failTransaction(player, "purchase", "Could not count out that much cash.");
    return false;
  }
  const change = held - PHONE_PRICE;
  player.sendMessage(
    `§a[EconomyX] ${formatMoney(PHONE_PRICE)} paid in cash.` +
      (change > 0 ? ` §7Change was returned to your inventory.` : "")
  );
  return true;
}

/* ------------------------------------------------------------
 *  The shop
 * ---------------------------------------------------------- */

async function openDealerShop(player, dealer) {
  const { t } = api;
  for (;;) {
    if (!alive(dealer)) return;
    const stock = readStock(dealer);

    const form = new ActionFormData()
      .title(t("EX Phone Dealer"))
      .body(
        stock.length
          ? `§7Every handset: §a${formatMoney(PHONE_PRICE)}\n` +
            `§8I carry what I can get hold of. Come back in a few days for different stock.\n\n` +
            `§7In stock: §f${stock.length}`
          : `§7My shelf is empty right now.\n§8Come back in a few days — I restock every ${RESTOCK_DAYS} days.`
      );

    for (const id of stock) {
      const p = PHONE_BY_ID.get(id);
      form.button(`${p.name}\n§7${formatMoney(PHONE_PRICE)} §8· ${p.brand}`);
    }
    form.button("§7Leave");

    const res = await form.show(player);
    if (res.canceled) return;
    if (res.selection === stock.length) return;

    const chosen = stock[res.selection];
    if (!chosen) return;
    const bought = await openPaymentScreen(player, dealer, chosen);
    if (bought) return; // one phone per visit; walk up again to buy another
  }
}

async function openPaymentScreen(player, dealer, phoneId) {
  const { t, cashTotal, findCardInInventory, CARD_IDS, CREDIT_IDS, readCardData, readCreditData, creditTierFromTypeId, getCreditTier } = api;
  const phone = PHONE_BY_ID.get(phoneId);

  for (;;) {
    if (!alive(dealer)) return false;

    // Describe what each method can actually cover right now, so the player
    // is never guessing which one will go through.
    const debitFound = findCardInInventory(player, CARD_IDS);
    const creditFound = findCardInInventory(player, CREDIT_IDS);
    const cash = cashTotal(player);

    const debitLine = debitFound
      ? `§7Debit: §a${formatMoney(readCardData(debitFound.stack).balance)}`
      : "§8Debit: no registered card";
    let creditLine = "§8Credit: no registered card";
    if (creditFound) {
      const tier = getCreditTier(creditTierFromTypeId(creditFound.stack.typeId));
      const avail = tier.limit === Infinity ? Infinity : tier.limit - readCreditData(creditFound.stack).debt;
      creditLine = `§7Credit available: §a${avail === Infinity ? "Unlimited" : formatMoney(avail)}`;
    }
    const cashLine = cash > 0 ? `§7Cash on hand: §a${formatMoney(cash)}` : "§8Cash: none on you";

    const form = new ActionFormData()
      .title(t("Phone Dealer — Pay"))
      .body(
        `§f${phone.name}\n§7Price: §a${formatMoney(PHONE_PRICE)}\n\n` +
          `${debitLine}\n${creditLine}\n${cashLine}\n\n` +
          `§8Cards need your PIN. Cash is handed over on the spot and change comes straight back.`
      )
      .button("§l💳 Pay by Debit Card\n§8PIN required")
      .button("§l💳 Pay by Credit Card\n§8PIN required · adds debt")
      .button("§l💵 Pay in Cash\n§8Change returned automatically")
      .button("§7Back");

    const res = await form.show(player);
    if (res.canceled) return false;
    if (res.selection === 3) return false;

    let paid = false;
    if (res.selection === 0) paid = await payByDebit(player);
    else if (res.selection === 1) paid = await payByCredit(player);
    else paid = payByCash(player);

    if (!paid) continue; // stay on this screen so they can try another method

    // Take it off the shelf only once the money is actually in.
    removeFromStock(dealer, phoneId);
    if (!deliver(player, phoneId)) {
      player.sendMessage("§c[EconomyX] Could not hand over the phone — check the floor around you.");
    }
    celebrate(dealer, player, res.selection === 2 ? "random.orb" : CONFIG.sounds.cardInsert);
    api.actionBar(player, `§a${phone.name} purchased`);
    api.holdActionBar(player, 60);
    return true;
  }
}

/* ------------------------------------------------------------
 *  The EX Book
 * ---------------------------------------------------------- */

const BOOK_PAGES = [
  {
    title: "What EconomyX is",
    body:
      "§7EconomyX turns money into a §fphysical thing§7.\n\n" +
      "§7Coins and notes sit in your inventory and drop when you die. A bank card is an item too — " +
      "§fthe balance lives on the card, not on your name§7.\n\n" +
      "§cLose the card and you lose the account.§7 Keep it somewhere safe.\n\n" +
      "§8Nothing here is tied to your username. Everything is on the item."
  },
  {
    title: "Money",
    body:
      "§7The currency is §fUD§7.\n\n" +
      "§6Coins§7 — Bronze 1, Two Cent 2, Silver 5, Gold 10, Fifty 50, Hundred 100.\n" +
      "§aNotes§7 — 1, 2, 5, 20, 50, 100, 200, 500, 1000.\n\n" +
      "§7Coins come from ingots: copper makes bronze, iron makes silver, gold makes gold. " +
      "Notes start at paper and bundle upward.\n\n" +
      "§7A bank also takes §fEmeralds (190)§7 and §fDiamonds (150)§7 on deposit."
  },
  {
    title: "Getting an account",
    body:
      "§7Craft a card, then §fsneak and use it§7. A plain tap does nothing.\n\n" +
      "§7You pick a §f5-digit account number§7 and a §f6-digit PIN§7 on a keypad.\n\n" +
      "§7Sneak + use a card any time to read its balance.\n\n" +
      "§cFive wrong PINs locks a card.§7 The owner unlocks it by sneaking and using it.\n\n" +
      "§8Signing up does not open a bank menu. For that you need a machine."
  },
  {
    title: "The machines",
    body:
      "§7Every banking machine is §ftwo blocks§7: a Machine Base with a head on top. " +
      "The head does nothing without the base.\n\n" +
      "§fATM§7 — withdrawals only. Debit and credit.\n" +
      "§fUTM§7 — deposit, transfer, settings. Debit only.\n" +
      "§fDebt Payment Block§7 — the only place to pay off credit.\n\n" +
      "§eThe machine keeps your card while you are signed in.§7 Press §fEject Card§7 to get it back — " +
      "that is the only way out. Closing the screen just reopens it.\n\n" +
      "§8Only the EX Tool can break a machine."
  },
  {
    title: "Credit and debt",
    body:
      "§7A credit card holds §cdebt§7, not a balance.\n\n" +
      "§7Dirt 1,000 · Gold 10,000 · Diamond 50,000 · Netherite 120,000 · Amex Platinum unlimited.\n\n" +
      "§c§lRead this twice.§r §7Interest is brutal by design. It is charged every time you borrow, " +
      "and again every 10 days that you still owe. The deeper into your limit you are, the worse the rate — " +
      "up to double at the top.\n\n" +
      "§7Debt does not go away on its own. Pay it at a Debt Payment Block."
  },
  {
    title: "Gambling",
    body:
      "§7The §fLottery§7 and §fBlackjack§7 blocks open with an §fempty hand§7. " +
      "Pick debit, credit or cash inside the menu.\n\n" +
      "§aWin§7 and you keep your stake and gain half of it again.\n" +
      "§cLose§7 and you pay your stake and half again on top.\n\n" +
      "§7Bet 100 and win, you are up 50. Bet 150 and lose, you are down 225.\n\n" +
      "§c§lThe house wins long-term.§r §7The lottery pays out 60% of the time, which is not enough " +
      "to cover a loss costing 1.5x. Play with what you can afford to lose."
  },
  {
    title: "Phones",
    body:
      "§7Phones §fcannot be crafted§7. There is no recipe and there never will be.\n\n" +
      "§7Find an §5EX Phone Dealer§7 — one settles in every village. Walk up and use them.\n\n" +
      "§7Every handset costs §a" +
      formatMoney(PHONE_PRICE) +
      "§7, whichever model you pick.\n\n" +
      "§7Pay by §fdebit§7 or §fcredit§7 (your PIN is required) or in §fcash§7 — hand over more than the price " +
      "and the change comes straight back to you.\n\n" +
      "§8Each dealer carries a handful of models and swaps its stock every few days."
  },
  {
    title: "Cards, the EX Tool, tips",
    body:
      "§7The §f55 playing cards§7 are decoration — a full deck, two jokers and a face-down card. " +
      "They show as real 3D models in your hand and on the ground. Mobs are not allowed to hold them.\n\n" +
      "§7The §fEX Tool§7 is the only thing that breaks a machine. Sneak and hit one to pick it up. " +
      "890 durability, repairs with iron.\n\n" +
      "§e§lTips§r\n" +
      "§7• Keep your card in an ender chest when you are not banking.\n" +
      "§7• Transfers cost a fee, and the person receiving may earn cashback.\n" +
      "§7• Dropped phones, cards and tools are not normal items — hoppers cannot pick them up.\n" +
      "§7• Lost this book? One dirt block makes another."
  }
];

async function openBook(player, page) {
  const { t } = api;
  for (;;) {
    if (page === undefined) {
      const form = new ActionFormData()
        .title(t("EX Book"))
        .body("§7A plain-language guide to EconomyX.\n§8Pick a chapter.");
      for (const p of BOOK_PAGES) form.button(p.title);
      form.button("§7Close");
      const res = await form.show(player);
      if (res.canceled || res.selection === BOOK_PAGES.length) return;
      page = res.selection;
      continue;
    }

    const p = BOOK_PAGES[page];
    const form = new ActionFormData()
      .title(t(p.title))
      .body(p.body)
      .button("§7Contents");
    if (page > 0) form.button("§7◀ Previous");
    if (page < BOOK_PAGES.length - 1) form.button("§7Next ▶");

    const res = await form.show(player);
    if (res.canceled) return;
    if (res.selection === 0) {
      page = undefined;
      continue;
    }
    const hasPrev = page > 0;
    if (hasPrev && res.selection === 1) page -= 1;
    else page += 1;
  }
}

function grantBookOnce(player) {
  try {
    if (player.getDynamicProperty(BOOK_GRANTED_KEY) === true) return;
    player.setDynamicProperty(BOOK_GRANTED_KEY, true);
    deliver(player, BOOK_ID);
    player.sendMessage("§5[EconomyX] §7You were given an §fEX Book§7. Use it to learn how the economy works.");
  } catch (err) {
    console.warn(`[EconomyX] book grant: ${err}`);
  }
}

/* ------------------------------------------------------------
 *  The on-screen phone display
 *
 *  While a phone is in the main hand we keep an invisible title alive; the
 *  JSON-UI panel in RP/ui/hud_screen.json watches for it and paints the
 *  handset's black screen in the centre of the display. The moment the phone
 *  leaves the hand the title is cleared and the panel switches itself off.
 *
 *  The title is re-sent faster than it expires so the overlay cannot flicker
 *  between refreshes, and it is only re-sent on a state change or a tick
 *  boundary, never every tick.
 * ---------------------------------------------------------- */

function holdingPhone(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    const held = inv.getItem(player.selectedSlotIndex);
    return !!held && PHONE_ID_SET.has(held.typeId);
  } catch {
    return false;
  }
}

function updatePhoneHud(player) {
  const on = holdingPhone(player);
  const was = hudShown.get(player.id) === true;

  if (on) {
    hudShown.set(player.id, true);
    try {
      player.onScreenDisplay.setTitle(HUD_TAG, {
        fadeInDuration: 0,
        stayDuration: HUD_STAY,
        fadeOutDuration: 0
      });
    } catch {
      /* screen display not ready this tick — the next pass picks it up */
    }
    return;
  }

  if (was) {
    hudShown.set(player.id, false);
    try {
      // Only ever clear a title WE put up. If the marker is gone already,
      // something else owns the title and we must not stamp on it.
      player.onScreenDisplay.clearTitle();
    } catch {
      /* no-op */
    }
  }
}

/* ------------------------------------------------------------
 *  Wiring
 * ---------------------------------------------------------- */

export function initPhones(injected) {
  api = injected;
  const { safeSubscribe, debounceOpen } = api;

  /* ---- Village scan ---- */
  safeSubscribe("phoneDealerSpawner", () => {
    system.runInterval(() => {
      try {
        for (const player of world.getAllPlayers()) {
          try {
            trySpawnDealerFor(player);
          } catch {
            /* skip this player, keep the loop alive */
          }
        }
      } catch (err) {
        console.warn(`[EconomyX] dealer spawner: ${err}`);
      }
    }, SPAWN_SCAN_RATE);
  });

  /* ---- Talking to the dealer ---- */
  safeSubscribe("phoneDealerInteract", () => {
    world.afterEvents.playerInteractWithEntity.subscribe((event) => {
      try {
        const { player, target } = event;
        if (!target || target.typeId !== DEALER_ID) return;
        // Sneak + use on a card is the "check my balance" gesture. Leave it alone.
        if (player.isSneaking) return;
        if (!debounceOpen(player)) return;
        system.run(() => {
          openDealerShop(player, target).catch((e) => console.warn(`[EconomyX] dealer shop: ${e}`));
        });
      } catch (err) {
        console.warn(`[EconomyX] dealer interact: ${err}`);
      }
    });
  });

  /* ---- Opening the book ---- */
  safeSubscribe("exBookUse", () => {
    world.afterEvents.itemUse.subscribe((event) => {
      try {
        const player = event.source;
        if (!player || player.typeId !== "minecraft:player") return;
        if (event.itemStack?.typeId !== BOOK_ID) return;
        if (!debounceOpen(player)) return;
        system.run(() => {
          openBook(player, undefined).catch((e) => console.warn(`[EconomyX] ex book: ${e}`));
        });
      } catch (err) {
        console.warn(`[EconomyX] book use: ${err}`);
      }
    });
  });

  /* ---- On-screen phone display ---- */
  safeSubscribe("phoneHudTicker", () => {
    system.runInterval(() => {
      try {
        for (const player of world.getAllPlayers()) {
          try {
            updatePhoneHud(player);
          } catch {
            /* skip this player, keep the loop alive */
          }
        }
      } catch (err) {
        console.warn(`[EconomyX] phone hud: ${err}`);
      }
    }, HUD_RATE);
  });

  safeSubscribe("phoneHudCleanup", () => {
    world.afterEvents.playerLeave.subscribe((event) => {
      hudShown.delete(event.playerId);
    });
  });

  /* ---- First-join book ---- */
  safeSubscribe("exBookFirstJoin", () => {
    world.afterEvents.playerSpawn.subscribe((event) => {
      try {
        if (!event.initialSpawn) return;
        const player = event.player;
        // A short delay so the grant lands after the inventory is really ready,
        // and after main.js has handed back any card stranded in a terminal.
        system.runTimeout(() => grantBookOnce(player), 60);
      } catch (err) {
        console.warn(`[EconomyX] first join book: ${err}`);
      }
    });
  });

  console.warn(`[EconomyX] phones ready — ${PHONE_IDS.length} handsets at ${formatMoney(PHONE_PRICE)}`);
}
