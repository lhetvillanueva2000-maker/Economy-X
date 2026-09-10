# Changelog

Every release from 2.8 onward gets an entry here, and that entry is what goes in
the GitHub release description. **2.7 is the first public release**, so its
description is the full feature list instead — see the README.

Versions run 2.7 → 2.8 → 2.9 → 3.0 → 3.1 and so on. The pack folders, both
manifest names and both manifest version arrays all carry the same number, and
the `.mcaddon` / `.zip` are named to match.

---

## 3.2

### Changed
- **The phone screen is a phone now, not a grey rectangle.** Each of the nine
  handset fronts fills the form: black glass, the right cutout for that model,
  and a **physical button rail down the right-hand edge** — volume up and volume
  down paired near the top, and a noticeably longer power key set lower, the way
  a real handset is laid out.
- **The glass is left clean.** No labels or panels are painted onto the screen.
- **Put Away is gone.** Power is the exit, and keeps its own name — that is what
  a power button does on a real phone.
- Phone button text is light on the new dark skin rather than black, which was
  right for Bedrock's grey buttons but wrong here.

### Honest limitation
- The rail is **artwork on the handset**. The things you actually press are
  still Bedrock's form buttons, because the form's button factory stacks its
  buttons vertically and exposes no per-button index binding to position them
  individually — see the note in `ui/server_form.json`. The phone therefore
  *reads* correctly, but a tap lands on the stacked control rather than on the
  painted key. Making the rail itself tappable is not possible through a
  scripted form.

---

## 3.1

### Fixed
- **Every button label was unreadable.** Bedrock draws form buttons light grey,
  and most labels were pale grey (`§7`), yellow or cyan on top of that — text
  only appeared when hover turned a button green. All **51** button labels
  across the mod are now black. This was never phone-specific; the bank menus,
  the keypads and the EX Book all had it.
- **The phone screen art never showed.** It lived in the layer that is inserted
  at the FRONT of the form's controls, which draws BEHIND the form's own
  background. The nine handset fronts now sit in their own layer inserted at the
  BACK so they draw over it, anchored to the top of the form so the buttons
  underneath stay clickable. The bank skin keeps its original behind-the-form
  layer, untouched.

### Changed
- **Facing, read off testing rather than inferred.** First person and third
  person look at the hand bone from about 90 degrees apart, so one Y rotation
  cannot show a flat face in both — which is why there are two animations.
  Testing showed first person at Y=215 looking straight at the camera module and
  third person at Y=215 edge-on, so first person moves to **35** (215-180, screen
  toward you) and third person to **125** (215-90, a face rather than an edge).
- **The phone is held like you are looking at it**, not like a flagpole: first
  person tilts to -42 with a slight roll. The playing card was leaning too far
  and eases back to -30.

---

## 3.0

### Fixed
- **Held models still were not on the hand.** The 2.8 fix put the height in the
  animation, which was the wrong place: a bone animation's `position` is applied
  in the bone's OWN ROTATED frame, so a large Y lift combined with a rotation
  slid the model sideways rather than lifting it. That is why the phone floated
  beside the arm and the playing card lay on the ground. The hand height is now
  baked into the **geometry** — every held `.geo.json` has its cubes shifted so
  the model's centre sits at y=22 with the bone pivot at `[0,22,0]`, exactly the
  way Microsoft's own wrench sample does it. Geometry coordinates are never
  rotated, so the offset holds. The animations now only rotate and scale.
- **The phone showed its cameras to the holder, not its screen.** Testing showed
  the facing was a full 180 out from what the geometry alone suggested, so the
  base Y rotation moves to 215 (180 + the 35 three-quarter turn).
- **Phones and the EX Book broke blocks.** Tapping a block while holding either
  mined it, and in creative that is instant — so sneak + use to open a screen
  chewed holes in the world. Neither can break anything now, in any game mode.

### Changed
- **The phone screen is a real handset front, per model.** Nine fronts, each
  keyed off the model name already in the form's title: a Dynamic Island for the
  iPhone, a pill cutout for HONOR and Huawei, a punch-hole for Samsung, OPPO,
  vivo and Nothing, and an unbroken black screen for the RedMagic, which has an
  under-display camera and no cutout at all.

### Still true
- The screen's buttons are Bedrock form buttons drawn over that front. Bedrock
  cannot open a custom clickable JSON-UI screen from a script, so the phone
  reads as a phone but is not a pixel-accurate one.

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
