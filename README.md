# EconomyX (EX)

A Minecraft **Bedrock Edition** add-on that puts a working bank inside your
world: debit cards with real balances, credit cards with real debt, physical
cash you can carry and lose, ATMs and terminals you have to walk up to and
sign into, two gambling blocks that will happily take it all off you, and a
village phone dealer who will sell you a 4,050 UD handset if you can afford it.

**Author:** Usersainyy
**Current version:** 2.9
**Requires:** Minecraft Bedrock **1.26.13 or newer**

---

## Installing

Download `EconomyX_v2.9.mcaddon` and open it — Minecraft imports both packs
for you. Then, in your world settings, enable **both**:

- `EconomyX v2.9 [BP]` under Behavior Packs
- `EconomyX v2.9 [RP]` under Resource Packs

The two packs depend on each other and will refuse to load alone.

---

## Experiments and other add-ons

**EconomyX works with every experimental toggle off, every toggle on, or any
mix of them.** Nothing in either pack is gated behind an experiment:

| Toggle | Does it affect EconomyX? |
|---|---|
| **Beta APIs** | **No.** It only *adds* the `-beta` module versions; it never removes the stable ones. EconomyX builds against stable `@minecraft/server` 2.6.0 and `@minecraft/server-ui` 2.0.0, which load either way. |
| Custom Components V2 | No. No item declares a custom component. |
| Custom Biomes · Data-Driven Jigsaw Structures | No. There is no `worldgen/` folder. |
| Experimental Creator Camera | No. No camera presets. |
| Render Dragon for Creators | No. No PBR texture sets. |
| Villager Trade Rebalancing | No. The phone dealer runs a scripted shop, not a vanilla trade table, so rebalancing cannot touch its prices or stock. |

So you can drop EconomyX into a world running add-ons that *do* need
experiments, and leave the toggles wherever those add-ons want them.

### The thing that actually conflicts: UI files

Bedrock loads exactly **one** copy of each UI file. Whichever resource pack sits
highest in the world's pack list wins, and every other pack's version of that
file is ignored outright. EconomyX ships exactly one:

| File | What it does | Losing it costs you |
|---|---|---|
| `ui/server_form.json` | Dark skin on EconomyX's menus, and the handset front behind the phone screen | Menus look like stock Bedrock forms; the phone screen keeps its working buttons but loses its painted front |

**EconomyX does not touch `hud_screen.json` at all**, so your HUD and any other
add-on's HUD are left completely alone.

`server_form.json` is written **additively** — it inserts a layer and never
redefines a vanilla control — so when EconomyX wins the stack, vanilla forms
still work perfectly. What is lost is the *other* pack's changes to that file.

If another add-on's menu skin matters more, you have two clean fixes:

1. **Move that add-on's resource pack above EconomyX** in the world's pack list.
   EconomyX loses only a cosmetic layer.
2. Delete `EconomyX_v2.9_RP/ui/server_form.json`. Nothing else reads it.

Either way the banking, phones, dealer and gambling are untouched — this file is
skin, not machinery.

---

## The idea

Money is a physical object. Coins and bills sit in your inventory, take up
slots, and drop when you die. A card is a physical object too — it holds its
own balance, and if you lose the card, you lose the account.

Nothing is tied to your player name. Everything lives on the item.

---

## Currency

The unit is **UD**. Coins and bills are both real items; they only differ in
denomination.

**Coins**

| Bronze | Two Cent | Silver | Gold | Fifty Cent | Hundred Cent |
|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 5 | 10 | 50 | 100 |

**Bills**

| 1 UD | 2 UD | 5 UD | 20 UD | 50 UD | 100 UD | 200 UD | 500 UD | 1000 UD |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 5 | 20 | 50 | 100 | 200 | 500 | 1000 |

Vanilla valuables are accepted at a terminal too: **Emerald 190**,
**Diamond 150**.

Coins are crafted one-for-one from the matching ingot. Bills are crafted by
bundling smaller bills with paper.

---

## Cards

### Debit — 18 of them

Sixteen dye colours plus two premium tiers. A debit card holds a **balance**.

| Tier | Card | Transfer fee | Cashback |
|---|---|---:|---:|
| Standard | the 16 dye colours | 5% | 0% |
| Premium | Black & Silver | 2.5% | 5% |
| Legendary | Black & Gold | 0% | 10% |

Transfer limit is a flat **50,000 UD** on every tier.

Craft: `Plain Card` + `Paper` + the matching dye. The two premium cards also
want an ingot — silver takes iron, gold takes gold.

### Credit — 5 of them

A credit card holds **debt**, not a balance. The tier sets how much you can
borrow and how brutally it compounds.

| Card | Credit limit | Interest rate |
|---|---:|---:|
| Dirt | 1,000 | 0.5 |
| Gold | 10,000 | 0.75 |
| Diamond | 50,000 | 1.0 |
| Netherite | 120,000 | 1.25 |
| Amex Platinum | unlimited | 1.5 |

> **Read the rate column again.** Those are multipliers, not percentages. A
> rate of 0.5 means the debt grows by **50% every time interest is charged**,
> and it compounds. This is deliberate. If you want something survivable, set
> `interestRate` to `0.005`–`0.015` in `scripts/config.js`.

Interest is charged **every time you borrow**, and again every **10 in-game
days** while any debt remains. It is applied lazily, the moment you next touch
the card. On top of that, the deeper you are into your limit the harsher the
rate gets, up to **2×** the tier rate when you are maxed out.

Dirt → Gold → Diamond → Netherite are each crafted by upgrading the one below.
Amex Platinum needs a Netherite card, a Nether Star and an Emerald Block.

---

## Opening an account

Hold a fresh card and **sneak + use** it. Never a plain tap — a plain tap does
nothing at all.

You pick a **5-digit account number** and a **6-digit PIN** on an on-screen
keypad. There is no text field anywhere: the only inputs are digit buttons, so
a 6-digit PIN can only ever be 6 digits.

Account numbers are unique **per card class**. Two debit cards can't share a
number, but a debit and a credit card can. The number is stamped onto the
card's lore so you can read it in your inventory.

Signing up does **not** open a bank menu. Sign-up is not sign-in.

Sneak + use a registered card any time to read its balance or debt off the
action bar.

---

## The machines

All three banking heads must sit **directly on top of an EconomyX Machine
Base**, and they face you when you place them.

| Machine | Takes | Does |
|---|---|---|
| **ATM Head** | debit **and** credit | **Withdrawals only.** Debit pulls from your balance; credit is a cash advance that adds debt and charges interest immediately. |
| **UTM Head** | **debit only** | Everything except withdrawal — deposit, transfer, balance, settings. |
| **Debt Payment Block** | **credit only** | The only place credit debt gets settled. |
| **Lottery / Blackjack** | nothing in hand | Gambling. Pick your funding source in the menu. |

Machines are hard to break and **only the EX Tool can dismantle one**, in
creative and survival alike. Every other attempt is cancelled outright.

### Signing in

A terminal never remembers anyone. **Even the owner types the PIN, every
session.**

When you sign in the terminal **swallows your card** — it leaves your
inventory. You get it back with the **Eject Card** button, and only that
button. Back buttons return you to the terminal's home screen. There is no
idle timeout: a card in a machine keeps the session alive indefinitely.

Bedrock will not let an add-on remove a form's close (X) button, so terminal
screens **reopen themselves** if you close them. Eject is the real exit.

Card return has three fallbacks — hand, then inventory, then the floor — so a
card can never be destroyed. If you log out mid-session, the card is parked in
world storage and handed back the next time you spawn.

Five wrong PINs locks the card. The owner clears the lockout by sneak + using
it.

---

## Gambling

Both blocks open on an **empty hand**. Choose Debit card, Credit card or Cash
inside the menu; the game finds it in your inventory.

One payout rule covers both:

- **Win** → you keep your stake and gain **50%** of it. Bet 100, walk away +50.
- **Lose** → you lose your stake **and 50% more**. Bet 150, you are down 225.

Bets are capped at your funds ÷ 1.5, so a losing hand can never overdraw a
balance or take cash you are not carrying.

**Lottery** is a straight roll — **60% win chance**. Be clear-eyed about what
that means with a 1.5× loss: it is a **30% house edge**, about −30 UD for every
100 you stake. Break-even would be a 75% win rate. `lotteryWinChance` in
`config.js` is one line if you want to move it.

**Blackjack** deals you two cards against a dealer who stands on 17. Double,
Hit and Stand all work; Double takes exactly one more card and stands. A tie
pushes and nothing moves.

Losses on a credit card are borrowed money — they land on your debt and accrue
interest like anything else.

---

## Phones

Twenty-six handsets across nine models — iPhone 17 Pro Max, Galaxy S26 Ultra,
OPPO Find X9 Ultra, vivo X300 Ultra, vivo X500, HONOR Magic9 Pro Max, Huawei
Mate 80 Pro, Nothing Phone (4a) Pro and RedMagic 11S Pro. Each renders as a
real 3D model in your hand, built from published device dimensions.

**You cannot craft a phone.** There is no recipe, and there is not meant to be
one. In creative they sit in their own menu group; in survival there is exactly
one way to get one.

### The dealer

An **EX Phone Dealer** settles in every village — any village type, any villager
variant. The mod finds villages by looking for a cluster of vanilla villagers
near you and placing one dealer per area, so a dealer turns up wherever a real
village is and never in empty terrain.

Walk up and use them. No need to hold anything.

Every handset costs a flat **4,050 UD**, whichever model you pick. Each dealer
carries **four to six models** and rerolls its stock every **3 in-game days**,
so the phone you want is worth shopping around for.

| Paying by | What happens |
|---|---|
| **Debit card** | PIN required. Deducted from the balance. |
| **Credit card** | PIN required. Borrowed against your limit, and interest is charged on the spot exactly like a cash advance. |
| **Cash** | Handed over on the spot, no PIN. Overpay and the change comes straight back to your inventory. |

The dealer is damage-immune and never despawns — a raid can't cost a village its
only phone shop. Mobs can't pick a dropped phone up either.

### Holding one

The screen faces **you**; the cameras face **everyone else**. That falls out of
the models themselves — in all nine handsets the camera bumps sit on the −Z side
of the body, so at a yaw of zero the back points the way you're facing and the
screen points back at you, in first and third person alike.

### Opening one

**Sneak + use** a phone to open its screen — the same gesture that reads a bank
card in your hand. The screen is deliberately **blank**; the three buttons on it
are the handset's physical ones:

| Button | What it does |
|---|---|
| ▲ Volume Up | Clickable, inert for now |
| ▼ Volume Down | Clickable, inert for now |
| ⏻ Power | Clickable, inert for now |

Putting the phone away closes the screen.

> Bedrock cannot open a custom clickable JSON-UI screen from a script — the form
> system is the only UI a script can both open *and* read a press back from. So
> the phone screen is a form, with the handset's front painted behind it by
> `ui/server_form.json`. The buttons are real and wired; they simply do nothing
> yet.

> Phones are **look-only for now**: a held item with a model, a screen and a
> price. No apps behind the glass yet.

---

## The EX Book

A plain-language guide to the whole mod, in eight chapters — what EconomyX is,
money, opening an account, the machines, credit and debt, gambling, phones, and
a tips page.

You are handed one **the first time you join**. Lost it? **One dirt block**
crafts another.

---

## Playing cards & the EX Tool

A full **55-card set**: the 52-card deck, two jokers, and a face-down card.
They render as **real 3D models** both in your hand and lying on the ground.

Dropped cards and tools are swapped for custom prop entities so they can carry
a model. That has a cost worth knowing:

> Dropped cards and EX Tools **cannot be collected by hoppers or minecarts**,
> and they do not merge into bigger stacks on the ground. Gravity, pickup and
> the 5-minute despawn all behave normally. Set `ENABLE_3D_DROPS` to `false`
> at the top of `scripts/props.js` for plain vanilla drops.

**Mobs cannot hold playing cards.** Zombies and friends will grab anything off
the floor, so a sweep takes cards back off them and drops them on the ground —
never deletes them. Armour stands and item frames are left alone, so you can
still put a card on display.

The **EX Tool** is the pickaxe-class tool that dismantles machines. 890
durability, 8 attack damage, repairs with iron, and enchantable with anything.

Its enchant slot is `all`, so an operator can `/enchant` it freely. That is
intentional: `/enchant` needs operator, operator means cheats are on, so a
survival player carrying a Sharpness EX Tool has visibly cheated and the mod
does not police it. Note that **Sharpness genuinely works** — it stacks on the
tool's 8 damage — while **Density, Breach and Wind Burst apply but do nothing**,
because their effects are wired to the Mace's own smash mechanic.

Craft: `Iron, Copper, Iron` / `Copper Stick` / `Stick`.

---

## Crafting quick reference

Exact quantities, not approximations.

| Item | Recipe |
|---|---|
| Iron Sheet | 1 Iron Ingot → **3** |
| Medium Sized Metal Sheet | 1 Iron Sheet + **2** Iron Nuggets |
| Plain Card | 1 Medium Sized Metal Sheet |
| Copper Stick | 2 Copper Ingots → **8** |
| EX Tool | `ICI` / `_S_` / `_T_` — I iron, C copper, S copper stick, T stick |
| EX Book | **1 Dirt** |
| Machine Base | 1 Iron Block + **2** Stone Slabs |
| ATM Head | **3** Iron Sheets + **2** Redstone + 1 Glass Pane + **2** Iron Ingots |
| UTM Head | **3** Iron Sheets + **2** Redstone + 1 Glass Pane + **2** Gold Ingots |
| Debt Payment Block | **3** Iron Sheets + **2** Redstone + 1 Glass Pane + 1 Redstone Block |
| Lottery Block | 1 Iron Block + **3** Emeralds + **2** Glass Panes |
| Blackjack Block | 1 Iron Block + **3** Emeralds + **4** Paper |

Debit cards are `Plain Card + Paper + dye`; the two premium tiers add an ingot.
Credit cards upgrade in a chain, each tier consuming the one below it.

**Playing cards and phones have no recipe.** Cards are creative-only; phones are
creative-only *or* bought from a dealer.

**Create mod bridge:** `create:iron_sheet` converts to `ex:iron_sheet` if Create
is installed. EconomyX has **no hard dependency** on Create; if it is absent the
recipe simply never registers.

---

## Tuning it

Everything worth balancing lives in `EconomyX_v2.9_BP/scripts/config.js`.

| Setting | Default | What it does |
|---|---|---|
| `creditTiers[*].interestRate` | 0.5 – 1.5 | Interest multiplier per credit tier |
| `interest.accrualDays` | 10 | In-game days between interest charges |
| `interest.maxDebtPenaltyMultiplier` | 2.0 | Worst-case rate multiplier at your limit |
| `gambling.winBonus` | 0.5 | Fraction of stake gained on a win |
| `gambling.lossPenalty` | 0.5 | Extra fraction of stake lost on a loss |
| `gambling.lotteryWinChance` | 0.6 | Lottery win probability |
| `security.pinLength` | 6 | PIN digits |
| `security.accountNumberLength` | 5 | Account number digits |
| `security.maxPinFailures` | 5 | Wrong PINs before lockout |
| `transfer.defaultRadius` | 15 | Blocks a transfer can reach |
| `tiers[*].transferLimit` | 50000 | Per-transfer cap |
| `values` | — | UD value of every coin, bill and vanilla valuable |

Phone numbers live in their own files:

| Setting | Where | Default | What it does |
|---|---|---:|---|
| `PHONE_PRICE` | `scripts/phone_data.js` | 4050 | Price of every handset |
| `STOCK_MIN` / `STOCK_MAX` | `scripts/phones.js` | 4 / 6 | Models each dealer carries |
| `RESTOCK_DAYS` | `scripts/phones.js` | 3 | In-game days between restocks |
| `VILLAGE_MIN_VILLAGERS` | `scripts/phones.js` | 2 | Villagers needed to count as a village |
| `DEALER_SPACING` | `scripts/phones.js` | 64 | Minimum blocks between two dealers |

---

## What's in the box

125 items · 6 blocks · 51 recipes · 82 3D attachables · 3 entities ·
2 custom sounds · 15 geometries

- 18 debit cards, 5 credit cards
- 6 coins, 9 bills
- 55 playing cards
- 26 phones
- 4 components + the EX Tool + the EX Book
- 6 machine blocks
- 2 dropped-item props + the EX Phone Dealer

---

## Repository layout

```
EconomyX_v2.9_BP/          behaviour pack
├── blocks/                6 machine blocks
├── entities/              card_prop, tool_prop, phone_dealer
├── item_catalog/          creative menu groups
├── items/                 44 items
│   ├── cards/             55 playing cards
│   └── phones/            26 phones
├── recipes/               51 recipes
└── scripts/
    ├── main.js            banking, terminals, gambling, machines
    ├── config.js          all the balance numbers
    ├── phones.js          the dealer, the phone shop, the EX Book
    ├── phone_data.js      GENERATED phone catalogue — do not hand-edit
    ├── props.js           3D dropped-item props
    └── guards.js          keeps cards and phones out of mob hands

EconomyX_v2.9_RP/          resource pack
├── animations/            held + dropped animation, phone hold poses
├── attachables/           82 3D held models — must stay FLAT
├── entity/                client entities for the props and the dealer
├── models/entity/         ex_card, ex_tool, ex_phone_dealer
│   └── phones/            9 phone geometries, one per handset
├── render_controllers/
├── sounds/ex/             card_insert, card_return
├── texts/
├── textures/
└── ui/server_form.json    the EconomyX form skin
```

---

## Known limitations

Stated plainly rather than buried:

- **The UI skin is unverified in-game.** It restyles EconomyX's forms via
  `ui/server_form.json`. It is written the safe way — it *inserts* a background
  layer rather than replacing vanilla's form structure, and both layers default
  to invisible so a binding that stops resolving turns the skin off instead of
  breaking a form. If a screen ever misbehaves, deleting
  `EconomyX_v2.9_RP/ui/server_form.json` reverts the look and changes nothing
  else.
- **Dropped cards and tools are not item entities** — see the note above about
  hoppers and stack merging.
- **Density, Breach and Wind Burst are cosmetic** on the EX Tool.
- **Interest is punishing by design.** See the warning in the credit section.
- **Custom Lottery and Blackjack panels** are not built. Both use the standard
  form layout.
- **Phones do nothing behind the glass yet.** The model and the screen overlay
  are real; there are no apps.
- **Held models are anchored by a bone binding, not by the animations.** Every
  held geometry's root bone carries
  `"binding": "q.item_slot_to_bone_name(context.item_slot)"`, which is what pins
  it into the hand. Without it Bedrock draws the model in the player's own model
  space — that is what put cards between the legs and left phones floating. The
  animations now only set rotation and scale; their positions are zero on
  purpose. If something ever renders down by the feet again, the binding is the
  thing to check, not the pose.
- **Grip rotation and scale still want an in-game eye.** All 26 phones tune from
  `RP/animations/ex_phone.animation.json` alone, which carries a symptom-to-fix
  table in its header.
- **The phone screen is a form, not a HUD.** Bedrock cannot open a custom
  clickable JSON-UI screen from a script, so the buttons are form buttons with
  the handset front painted behind them. It reads as a phone, but it is not a
  pixel-accurate one — the button positions are the form's, not the model's.
- **Dealer placement needs a real village.** Detection keys off a cluster of at
  least two vanilla villagers nearby, so a village whose villagers have all been
  killed will not get a dealer until they repopulate.

---

## Version history

| Version | What landed |
|---|---|
| **2.8** | Held models raised off the ground and centred on the hand — the bound-attachable offset was never cancelled out. Cards and phones now sit at a three-quarter angle so an edge shows |
| **2.7** | Held models finally sit in the hand — every held geometry is bound to the hand bone, which cards and the EX Tool had never been either. The always-on phone overlay is gone; the phone screen is now a form you open with sneak + use |
| **2.6** | Phones — 26 handsets with 3D held models, the village phone dealer that takes cards or cash, and the EX Book. Stopped policing EX Tool enchantments; enchant slot opened to `all` so `/enchant` actually works |
| **2.5** | UI skin moved into the resource pack proper; mobs can no longer hold playing cards |
| **2.4** | New 55-card set and EX Tool with 3D held and dropped models, replacing the old cards and the EX Pickaxe |
| **2.3** | Rebuilt the debit terminal, redesigned every screen, fixed back-button navigation, new gambling payouts, empty-hand gambling access |
| **2.2** | Last release before the terminal rebuild |

### Upgrading from 2.3 or earlier

The playing cards and the tool were replaced wholesale in 2.4 and their
identifiers changed (`ex:card_spades_a` → `ex:card_ace_of_spades`,
`ex:ex_pickaxe` → `ex:ex_tool`). Any old playing cards or EX Pickaxes sitting in
a world will disappear on update. **Debit and credit cards are unaffected** —
balances, debts, PINs and account numbers all carry over.

---

## Credits

Built by **Usersainyy**. The playing-card and EX Tool set was co-created with
Claude and Gemini before being folded into EconomyX.

Not affiliated with Mojang or Microsoft.
