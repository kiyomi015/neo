# Blitz lite (vendored)

`blitz-lite.css` is Blitz lite 1.5.2, a CSS framework for reflowable ebooks by Jiminy Panoz, MIT licensed (`LICENSE`, beside it). It is the upstream file, unchanged: https://github.com/FriendsOfEpub/Blitz/blob/v.1.5.2/Blitz_framework/CSS/AltStylesheets/blitz-lite/blitz-lite.css

Export → EPUB puts it at the top of the book's `style.css`, then NEO's own rules (`epub/neo.css`). Blitz resets what reading apps disagree on and leaves the rest to the reader; NEO's file sets how a NEO book looks on top of it. Don't edit Blitz: put every change in `neo.css`, so updating Blitz is replacing this one file.

Blitz reached end of life on 1 July 2020: its repositories are read-only and there is no successor. That's fine for this use. What Blitz handles (reading apps' defaults, Kindle and Adobe quirks) changes slowly, and NEO's own rules sit on top of it. If something in it ever needs to change, change it in `neo.css`, which comes after.
