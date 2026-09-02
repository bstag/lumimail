# Derived comparison assets

This directory is generated from the immutable Mantle source files in `../sigils/`.

- `primary-mark-reference.png` is the exact 290×336 sigil crop from
  `../sigils/primary-sigil-transparent.png` at `(102, 344)`. It is the visual oracle used to prevent
  future cleanup work from changing the supplied shield, route, chevrons, or waypoint geometry.

Regenerate it and the application masks/icons with `npm run brand:assets`. Do not edit the derived PNG
by hand.
