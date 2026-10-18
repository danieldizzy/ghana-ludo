# Ghana Ludo (+ Oware coming soon)

A browser-based Ludo game with Ghanaian / Adinkra theming. Pure HTML + CSS +
JavaScript + Canvas — no build step, hosts free on GitHub Pages.

## Play locally
Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000
    # then visit http://localhost:8000

## Features (MVP)
- Hot-seat multiplayer, 2–4 players
- Classic Ludo rules: roll a 6 to leave the yard, race clockwise, capture
  opponents on shared squares (safe squares protected), exact roll to finish,
  bonus turn on a 6, first player home with all 4 tokens wins.

## Tests
Pure rule logic is verified headlessly:

    node test.js

## Roadmap
- [ ] Oware (African mancala) game mode
- [x] Simple AI opponent (heuristic: capture > finish > leave yard > advance)
- [ ] Adinkra token artwork + richer kente theming
- [x] Sound effects (WebAudio, no files)

## Credits
Built for fun. Links from https://danieldizzy.github.io
