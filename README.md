# Songbook

A shared songbook for two: key, capo, tempo, tuning, lyrics, and notes,
readable at arm's length on a phone.

This repo holds the website only. The songs live in Firestore and are not
in here. Anyone with the link can read the songbook; only the two accounts
named in the Firestore rules can change it.

Source of truth for this code is `personal/songbook/` in the eps-os repo.
Edit it there and run `deploy.sh`, not here.
