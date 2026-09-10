/**
 * ============================================================
 *  EconomyX (EX) — Centralized Configuration
 *  Namespace: EX
 *  Target:    Minecraft Bedrock 1.26.13+
 *  Author:    Usersainyy
 * ============================================================
 *  Edit this file to re-balance the economy without touching
 *  any of the logic in main.js.
 * ============================================================
 */

export const CONFIG = {
  // Display suffix for money amounts (design notes: "User Dollars")
  currencyName: "UD",

  // ---- Base conversion values (all figures are in "UD") ----
  values: {
    "minecraft:emerald": 190,
    "minecraft:diamond": 150,
    "ex:coin_bronze": 1,
    "ex:coin_two": 2,
    "ex:coin_silver": 5,
    "ex:coin_gold": 10,
    "ex:coin_fifty": 50,
    "ex:coin_hundred": 100,
    "ex:cash_one": 1,
    "ex:cash_two": 2,
    "ex:cash_five": 5,
    "ex:cash_single": 20,
    "ex:cash_fifty": 50,
    "ex:cash_stack": 100,
    "ex:cash_two_hundred": 200,
    "ex:cash_bundle": 500,
    "ex:cash_thousand": 1000
  },

  // Items offered in the "Deposit Funds" menu, low -> high value
  depositableItems: [
    "minecraft:emerald",
    "minecraft:diamond",
    "ex:coin_bronze",
    "ex:coin_two",
    "ex:coin_silver",
    "ex:coin_gold",
    "ex:coin_fifty",
    "ex:coin_hundred",
    "ex:cash_one",
    "ex:cash_two",
    "ex:cash_five",
    "ex:cash_single",
    "ex:cash_fifty",
    "ex:cash_stack",
    "ex:cash_two_hundred",
    "ex:cash_bundle",
    "ex:cash_thousand"
  ],

  // Items offered in the "Withdraw Cash" / ATM cash-advance denomination selector
  withdrawableItems: [
    "ex:coin_bronze",
    "ex:coin_two",
    "ex:coin_silver",
    "ex:coin_gold",
    "ex:coin_fifty",
    "ex:coin_hundred",
    "ex:cash_one",
    "ex:cash_two",
    "ex:cash_five",
    "ex:cash_single",
    "ex:cash_fifty",
    "ex:cash_stack",
    "ex:cash_two_hundred",
    "ex:cash_bundle",
    "ex:cash_thousand"
  ],

  // Physical cash/coin items accepted by the UTM for paying down credit card debt
  repayableItems: [
    "ex:coin_bronze",
    "ex:coin_two",
    "ex:coin_silver",
    "ex:coin_gold",
    "ex:coin_fifty",
    "ex:coin_hundred",
    "ex:cash_one",
    "ex:cash_two",
    "ex:cash_five",
    "ex:cash_single",
    "ex:cash_fifty",
    "ex:cash_stack",
    "ex:cash_two_hundred",
    "ex:cash_bundle",
    "ex:cash_thousand"
  ],

  security: {
    pinLength: 6,
    accountNumberLength: 5,
    maxPinFailures: 5
  },

  transfer: {
    defaultRadius: 15
  },

  // ---- Debit Cards: 3-tier system ----
  // Standard: 16 colors matching vanilla dye colors.
  // Premium (Black & Silver) and Legendary (Black & Gold) are bonus high tiers.
  standardCardColors: [
    "pink", "magenta", "purple", "blue", "light_blue", "cyan",
    "black", "brown", "green", "grey", "light_gray", "lime", "orange", "red", "white", "yellow"
  ],
  premiumColor: "black_silver",
  legendaryColor: "black_gold",
  get cardColors() {
    return [...this.standardCardColors, this.premiumColor, this.legendaryColor];
  },

  // Tier Perks & Modifiers Matrix
  tiers: {
    legendary: {
      label: "Black & Gold (Legendary)",
      feePercent: 0,
      cashbackPercent: 10,
      transferLimit: 50000,
      useSound: "ex.card_insert",
      particle: "minecraft:totem_particle"
    },
    premium: {
      label: "Black & Silver (Premium)",
      feePercent: 2.5,
      cashbackPercent: 5,
      transferLimit: 50000,
      useSound: "ex.card_insert",
      particle: null
    },
    standard: {
      label: "Standard",
      feePercent: 5,
      cashbackPercent: 0,
      transferLimit: 50000,
      useSound: "ex.card_insert",
      particle: null
    }
  },

  lockout: {
    sound: "random.break",
    particle: "minecraft:villager_angry"
  },

  // ---- Credit Cards: 5-tier debt/spending-limit system ----
  creditColors: ["dirt", "gold", "diamond", "netherite", "amex_platinum"],

  // Interest multiplier per tier. Higher tier = more borrowing power, but
  // steeper interest. Applied as: interest = debt * rate, then debt += interest.
  //
  // NOTE: these are MULTIPLIERS, not percentages. 0.5 means the debt grows by
  // 50% each time interest is charged, and it compounds. Lower these values
  // (e.g. 0.005 - 0.015 for 0.5% - 1.5%) if that proves too punishing in play.
  creditTiers: {
    dirt: { label: "Dirt Credit Card", limit: 1000, interestRate: 0.5, useSound: "ex.card_insert" },
    gold: { label: "Gold Credit Card", limit: 10000, interestRate: 0.75, useSound: "ex.card_insert" },
    diamond: { label: "Diamond Credit Card", limit: 50000, interestRate: 1.0, useSound: "ex.card_insert" },
    netherite: { label: "Netherite Credit Card", limit: 120000, interestRate: 1.25, useSound: "ex.card_insert" },
    amex_platinum: { label: "Amex Platinum Credit Card", limit: Infinity, interestRate: 1.5, useSound: "ex.card_insert" }
  },

  // Effectively unlimited. No legitimate balance will ever reach this, but it
  // stays a finite number so arithmetic and formatting never see Infinity.
  maxBalance: 999999999999999,

  interest: {
    // Interest is charged on every borrow (cash advance / purchase)...
    chargeOnBorrow: true,
    // ...and again every this many in-game days while any debt remains.
    accrualDays: 10,
    // Extra penalty scaling: the deeper in debt relative to the card limit,
    // the harsher the rate. At the limit this doubles the tier rate.
    debtPenaltyEnabled: true,
    maxDebtPenaltyMultiplier: 2.0
  },

  // Terminal security: machines never remember a card between sessions.
  // Removing the card, closing the terminal, or logging out ends the session,
  // exactly like a real cash machine.
  sounds: {
    cardInsert: "ex.card_insert",
    cardReturn: "ex.card_return"
  },

  machineSession: {
    // How long an authenticated terminal session stays valid, in ticks (20 = 1s).
    timeoutTicks: 200
  },

  // ---- Blocks ----
  // Machine heads are two pieces: a shared base + a machine-specific head.
  // The head only functions when placed directly on top of the base.
  blocks: {
    base: "ex:machine_base",
    atm: "ex:atm_head",
    utm: "ex:utm_head",
    payment: "ex:payment_head",
    lottery: "ex:lottery_block",
    blackjack: "ex:blackjack_block"
  },

  // ---- Gambling payouts (v2.3) ----
  // Both blocks share one rule, so the maths reads the same wherever you play:
  //
  //   WIN  -> you keep your stake and gain winBonus x stake   (net +50%)
  //   LOSE -> you lose your stake and a further lossPenalty x stake (net -150%)
  //
  // Worked through: bet 100 and win, you end up +50 (you "receive 150").
  // Bet 150 and lose, you end up -225 (the 150 staked plus 75 more).
  //
  // Because a loss costs 1.5x the stake, a bet is capped at funds / 1.5 so a
  // losing hand can never push a balance negative or take cash the player
  // does not physically have. See maxBetFor() in main.js.
  gambling: {
    winBonus: 0.5, // gained on top of the stake when you win
    lossPenalty: 0.5, // taken on top of the stake when you lose
    // Chance of a winning outcome on the Lottery block, 0..1.
    // Blackjack does not use this - there the cards decide.
    lotteryWinChance: 0.6
  },

  // ---- Lottery Block ----
  lottery: {
    // Kept so the result screen can name the multiplier the player "got".
    // 1 + winBonus on a win, and the stake is simply gone on a loss.
    get winMultiplier() {
      return 1 + CONFIG.gambling.winBonus;
    }
  },

  // ---- Blackjack Block ----
  blackjack: {
    bust: 21,
    // The dealer stops drawing once it reaches this, like a real table.
    dealerStandsOn: 17
  },

  /* ---- Running alongside other add-ons ----
   *
   * EconomyX needs NO experimental toggles. Nothing in either pack is gated
   * behind one: both script modules are stable releases, and the "Beta APIs"
   * experiment only ADDS the "-beta" module versions, it never takes the
   * stable ones away. So EconomyX behaves identically with every experiment
   * off, every experiment on, or any mix — which means it is safe to drop into
   * a world running other add-ons that do require experiments.
   *
   * The genuine conflict risk with other add-ons is not experiments at all, it
   * is JSON-UI. Bedrock loads only ONE copy of each UI file: whichever pack
   * sits highest in the world's resource pack stack wins, and every other
   * pack's version of that file is ignored outright.
   *
   * EconomyX now ships exactly ONE such file:
   *
   *   ui/server_form.json  the dark skin on EconomyX's menus, and the handset
   *                        front painted behind the phone screen
   *
   * It used to ship ui/hud_screen.json as well, for an always-on phone overlay.
   * That is gone: the phone screen is a form you open with sneak + use, so the
   * HUD is left completely alone and there is one less contested file.
   *
   * server_form.json is written additively — it inserts a layer and never
   * redefines a vanilla control — so when EconomyX wins the stack, vanilla
   * forms still work perfectly. What is lost is the OTHER pack's changes to
   * that same file.
   *
   * If another add-on's menu skin matters more than EconomyX's, you have two
   * clean fixes, in order of preference:
   *   1. Move that add-on's resource pack ABOVE EconomyX in the world's pack
   *      list. EconomyX loses only the cosmetic layer.
   *   2. Delete EconomyX_v2.6_RP/ui/server_form.json. Nothing else in the mod
   *      reads it, so the banking, phones, dealer and gambling all carry on
   *      unchanged — the menus just look like stock Bedrock forms, and the
   *      phone screen loses its painted handset front while keeping its
   *      working buttons.
   */
  compat: {}
};

/** Returns the debit card tier definition object for a given card color. */
export function getTierForColor(color) {
  if (color === CONFIG.legendaryColor) return CONFIG.tiers.legendary;
  if (color === CONFIG.premiumColor) return CONFIG.tiers.premium;
  return CONFIG.tiers.standard;
}

/** Returns the credit tier definition object { label, limit, useSound } for a credit card color/tier key. */
export function getCreditTier(tierKey) {
  return CONFIG.creditTiers[tierKey] ?? CONFIG.creditTiers.dirt;
}

/** Formats a numeric amount as "$1,234 UD". */
export function formatMoney(amount) {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return `$${rounded.toLocaleString("en-US")} ${CONFIG.currencyName}`;
}
