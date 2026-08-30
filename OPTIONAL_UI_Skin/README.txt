EconomyX v2.3 — OPTIONAL UI SKIN  (opt-in, UNVERIFIED)
======================================================

WHAT THIS IS
------------
A recolour that paints the dark-purple panel and grey border from your
mockups behind EconomyX's forms, and leaves every other form in the game
alone.

It is NOT loaded by default. The add-on is complete and fully working
without it. This folder ships separately on purpose.


WHY IT IS SEPARATE
------------------
I could not test this on a device. Your handoff notes record that a
previous attempt at overriding server_form.json silently broke the deposit
and withdraw menus and had to be reverted — those are exactly the menus
rebuilt in v2.3, so I am not putting an untested override in the live path.

This version is written the safe way: it uses JSON-UI's "modifications"
syntax to INSERT a background layer into vanilla's long_form and
custom_form, rather than replacing them. Vanilla's title, body text,
button factory and close button are never redefined, so the machinery that
broke last time is not touched at all.

That lowers the risk a lot. It does not remove it, because I have not seen
it render.


HOW TO TRY IT
-------------
1. Copy the "ui" folder from here into:
       EconomyX_v2.3_RP/ui
   so you end up with:
       EconomyX_v2.3_RP/ui/server_form.json

2. Re-import the pack (or re-enter the world) and open any EconomyX
   terminal.

TO REVERT
---------
Delete EconomyX_v2.3_RP/ui/server_form.json. That is the whole rollback.
Every screen, button and flow keeps working — only the colour goes back to
stock Bedrock.


WHAT TO CHECK IF YOU DO ENABLE IT
---------------------------------
Walk these screens once each and confirm every button still responds:

  - UTM home            (Deposit / Transfer / Eject Card / Setting)
  - UTM Deposit         (currency list, then the keypad)
  - UTM Transfer        (recipient list, then the keypad)
  - Settings            (all four buttons and Back)
  - ATM                 (denomination list, then the keypad)
  - Debt Payment        (Pay / Eject card / Settings)
  - Lottery + Blackjack (digits, source toggles, Bet)
  - Sign In / Sign Up   (keypad, Confirm)

If any screen goes blank, loses its buttons, or stops responding, delete
the file — that is the known failure mode and it is fully reversible.


HOW THE TARGETING WORKS
-----------------------
Every EconomyX form title begins with the marker "§8§r" (UI_TAG in
scripts/main.js). It is a colour code followed immediately by a reset, so
it renders as nothing but is still readable by the #title_text binding.
The skin's visibility binding is:

    (not ((#ex_title - '§8§r') = #ex_title))

which is true only when that prefix is present. Vanilla forms and forms
from your other add-ons never match, so they render exactly as they do now.

If you delete the skin, the marker simply stops being read. It never shows
up as visible text either way.
