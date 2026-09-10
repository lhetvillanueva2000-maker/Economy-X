# Changelog

Every release from 2.8 onward gets an entry here, and that entry is what goes in
the GitHub release description. **2.7 is the first public release**, so its
description is the full feature list instead — see the README.

Versions run 2.7 → 2.8 → 2.9 → 3.0 → 3.1 and so on. The pack folders, both
manifest names and both manifest version arrays all carry the same number, and
the `.mcaddon` / `.zip` are named to match.

---

## 2.9

Version bump only — **no functional change from 2.8**. The pack folders,
manifests, README and built files all move to 2.9, and this section stays open
to collect whatever lands next.

Bump with `tools/bump_version.sh <old> <new>`, which updates the folder names,
both manifest names, both header and module version arrays, the sibling-pack
dependency versions and every README reference in one go. It deliberately leaves
the `@minecraft/server` dependency strings alone — those are scripting API
versions, not pack versions — and never touches the pack UUIDs, which must stay
fixed or an update installs as a second copy of the mod.

---

## 2.8

### Fixed
- **Held models sat on the ground.** The hand binding added in 2.7 attached them
  to the player correctly, but Bedrock applies a **-1.5 metre (-24 unit) offset**
  to a bound attachable, and nothing cancelled it out — so a model authored
  around the origin rendered down at the player's feet. Every held pose now adds
  +24 to undo it.
- **Models hung off the hand rather than sitting on it.** Each pose now also
  subtracts the model's own centre, so the MIDDLE of a card, phone or tool lands
  on the hand instead of its base:
  `position Y = 24 - (centre x scale)`.

### Changed
- Cards and phones are held at a **three-quarter angle** (Y rotation 35) so an
  edge shows and they read as solid objects rather than flat planes. The EX Tool
  is left square-on, since it is not flat to begin with.

### Note
- The dropped-item `bob` animations were deliberately left alone. Those drive
  prop *entities* on the ground, which are not hand-bound and so never had the
  -24 offset to cancel.

---

## 2.7

Everything in the mod, in one place. Full detail lives in the README.

**Banking**
- 18 debit cards across 3 tiers; 5 credit cards with compounding debt
- Balances, PINs and account numbers live on the card item, not on your name
- ATM, UTM and Debt Payment machines; each needs a Machine Base underneath
- Deposit, withdraw, transfer with fees and cashback, cash advances, repayment

**Money**
- 6 coins and 9 bills as real, droppable items; emeralds and diamonds accepted

**Gambling**
- Lottery and Blackjack, funded by debit, credit or the cash in your pockets

**Phones** *(new in this release)*
- 26 handsets across 9 models, as real 3D held models
- Bought from an EX Phone Dealer who settles in every village, 4,050 UD flat
- Pay by card with a PIN, or in cash with automatic change
- Sneak + use to open the phone screen

**Also**
- 55 playing cards, the EX Tool, and the EX Book handbook

### Fixed since the 2.6 development builds

- **Held models now actually sit in the hand.** No held geometry had a bone
  binding, so Bedrock drew each one in the player's own model space instead of
  at the hand — playing cards rendered between the legs and phones floated off
  the body. Every held geometry now carries
  `"binding": "q.item_slot_to_bone_name(context.item_slot)"`. This affected the
  playing cards and the EX Tool too, not just phones.
- **Held animations no longer fight the binding.** Their position offsets only
  existed to shove an unanchored model into view; they are now zero, and the
  animations set rotation and scale only.
- **Phone attachables used the wrong render controller.** They pointed at
  vanilla `controller.render.item_default` instead of the pack-owned
  `controller.render.ex_item`. The EX Tool had the same defect.

### Changed

- The always-on phone screen overlay is gone. The phone screen is now a form you
  open with **sneak + use**, with Volume Up, Volume Down and Power present and
  clickable — inert for now, apps come later.
- `ex_tool` geometry moved from format 1.12.0 to 1.16.0, which binding requires.

### Removed

- `ui/hud_screen.json`. EconomyX no longer touches the HUD at all, so it now
  contests exactly one UI file with other add-ons instead of two.
