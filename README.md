# Gesture City Map

**A constellation map of any city that you fly with your hands, right in the browser.** Grab it with four fingers, zoom with two, point and fold your finger to click, or teach it gestures of your own. Tick off the city's top places, earn badges and share your constellation. Swap in your own city by editing one file.

![Demo: a simulated hand dragging the map with four fingers, pointing, folding a finger to open a place, zooming with two fingers and rotating the Bengaluru map](docs/demo.gif)

**[Live demo](https://anurag12.vercel.app/map)** · [London example](https://anurag12.vercel.app/map?city=london) · [Watch the demo](https://anurag12.vercel.app/map?demo) (no camera needed)

No install, no build step, no server code. Hand tracking runs on your device with [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), so no video ever leaves your browser.

---

## Gestures

| Gesture | What it does |
|---|---|
| ✋ **Four fingers together**, then move your hand | Drags the map in any direction. Spread your fingers to let go |
| ✌️ **Two fingers** (index + middle), move **up** | Zooms in |
| ✌️ **Two fingers**, move **down** | Zooms out |
| ☝️ **One finger** | Moves the pointer, which snaps onto the nearest place |
| 👇 **Fold your index finger and lift it** (while pointing) | Opens the place under the pointer (or presses the button under it) |
| ✊ **Fist** (hold ⅓ s) | Closes the open place |
| 🙌 **Two hands**, turned like a steering wheel | Rotates the map |
| 🖐️ **Open palm, fingers spread** | Rest. Nothing happens |

👍 A thumbs up (hold ⅓ s) still opens a place too.

## Train your own gestures

Press **🧠 Train** (or <kbd>T</kbd>) to teach the map hand shapes of your own:

1. **Name it and pick what it does**: pan, zoom, pointer, click, close, reset view, zoom a step, rotate, open Explore, show my location or help. There's also **Rest** and **Ignore**.
2. **Press Add.** After a 3-2-1 countdown it records your hand for two seconds (about 60 samples). Move your hand a little nearer, further and tilted while it records, so it learns the shape and not one position.
3. **Check it.** The live preview shows what it sees and how sure it is. Each gesture shows how often its own samples are recognised and **which other gesture it gets mixed up with**. That's how you spot look-alikes. Fix them by recording more of each, or add an **Ignore** gesture for the shape it should leave alone.

Trained gestures win over the built-in ones when they match, and anything they don't match falls back to the built-in gestures. Pan, zoom and pointer gestures work with movement just like the built-in ones: hold your trained shape and move your hand. Everything is saved in your browser. **Export** writes a JSON file you can **Import** on another device.

How it works (`src/trainer.js`): each frame's 21 hand points are normalised (wrist at the origin, scaled by palm size, left hands mirrored). Then they're described by the points themselves plus finger straightness, thumb position, fingertip gaps and finger spread. Those extra measurements are what keep look-alike poses apart. A k-nearest-neighbour vote compares them with your samples. A match only counts when most neighbours agree **and** the nearest one is about as close as your own samples are to each other. It needs no training step and runs in well under a millisecond.

Tap the **◎ locate button** (bottom right, or <kbd>L</kbd>) to see yourself as a blue dot, like in Google Maps. It follows you as you move; tap it again once you're centred to turn it off. Your location stays on your device.

Mouse, touch and keyboard work too: drag, scroll or pinch to zoom, two-finger twist to rotate, click to open, <kbd>Esc</kbd> to close, <kbd>Q</kbd>/<kbd>E</kbd> to rotate, <kbd>/</kbd> to search.

## Make it your city

1. **Copy the template:** `cities/_template.js` → `cities/pune.js` (lowercase, no spaces).
2. **Add your places.** Each one needs a name, a category, `lat` and `lng`. Right-click any spot in Google Maps to copy its coordinates.
   ```js
   { name: "Shaniwar Wada", cat: "sights", lat: 18.5195, lng: 73.8553, rank: 3, area: "Kasba Peth", note: "Peshwa-era fort" }
   ```
3. **Open it** with `index.html?city=pune`, or set `data-city="pune"` at the top of `index.html` to make it the default.

**Prefer a spreadsheet?** Export a CSV with `name, category, lat, lng, rank, area, note` columns and convert it:

```bash
node tools/csv-to-city.mjs my-places.csv --name "Pune" > cities/pune.js
```

## Explore: tick off the top places

Press **🏆 Explore** (or <kbd>X</kbd>) for a checklist of the top places in each category.

- **Tick what you've been to.** Each place is worth its rank × 10 points (30, 20 or 10).
- **Check in on the spot** from the place card for **double points**. It uses your phone's location and needs you within about 400 m of the pin (1.5 km for approximate pins). Your location is only compared on your device and never sent anywhere.
- **Earn badges.** Every category has a badge with bronze, silver and gold tiers, and there are city-wide ones like *First Star*, *Wanderer* and *City Legend*. Points also raise your level, from *Stargazer* to *City Legend*.
- **Share it.** *Share* draws a picture of your own constellation (the places you've visited, joined up) or of a badge. On phones it opens the share sheet for Instagram, WhatsApp and the rest; there are also LinkedIn, Facebook, X and WhatsApp links, a download button and copy-link.

Progress is saved in your browser (`localStorage`), per city. Turn it on for your city with an `explore` block, and give categories badge names:

```js
explore: { top: 15, skip: ["rail", "air"] },   // top N per category; skipped categories stay on the map only
categories: {
  pubs: { label: "Pubs & Breweries", color: "#ffb020", icon: "🍺", badge: "Brewery Hopper" },
},
```

Without an `explore` block every category gets a top-15 list and a badge named "<label> Explorer".

<details>
<summary><b>Every config field</b></summary>

| Field | Required | What it is |
|---|---|---|
| `name` | ✓ | City name, used in the intro |
| `categories` | ✓ | `key: { label, color, icon }`. Each category becomes its own constellation |
| `places` | ✓ | `{ name, cat, lat, lng, rank, area, note, approx }`, or the short form `[name, cat, lat, lng, rank, area, note]` |
| `title`, `subtitle`, `credit` | | Text in the top-left corner |
| `center` | | `[lat, lng]` the map is measured from. Defaults to the middle of your places |
| `homeZoom` | | `>1` starts closer, `<1` further out |
| `theme` | | `{ accent, accent2 }` UI colours |
| `explore` | | `{ top, skip, radius, approxRadius }` for Explore mode: list length per category, categories to leave out, and check-in distance in metres |
| `categories[k].badge` | | Badge name for that category in Explore mode |
| `lines` | | Transit lines (`kind: "transit"`, `stops: [[name, lat, lng], …]`), roads (`kind: "road"`) and rivers (`kind: "water"`, `points: [[lat, lng], …]`) |

`rank` controls labels: 3 is always labelled, 2 when you zoom in a little, 1 when you zoom in a lot. A mistake in the config, like an unknown category, shows a warning and skips that place instead of breaking the map.
</details>

## Run it

- **On GitHub Pages:** fork this repo, then go to *Settings → Pages* and pick `main` / root. Your map is live at `https://<you>.github.io/gesture-city-map/`.
- **Locally:** any static server works, for example `npx serve` or `python3 -m http.server`, then open `http://localhost:8000`. The camera needs `https://` or `localhost`.

**Embed it** on another page with an iframe. `?embed` hides the toolbar and plays the demo on a loop:

```html
<iframe src="https://<you>.github.io/gesture-city-map/?embed" width="100%" height="520" style="border:0"></iframe>
```

Hand tracking works best in Chrome or Edge, in good light, with your hand 40–70 cm from the camera.

## How the gestures stay reliable

The gesture engine (`src/gestures.js`) is plain JavaScript with no DOM, so it's easy to read, tune and test.

- **Shape, not position.** Finger poses come from MediaPipe's 3-D *world* landmarks, so they read the same near or far, and with a tilted hand.
- **Hysteresis.** A new pose must hold for a few frames before it counts, so one bad frame can't trigger anything.
- **"Together" means together.** Four-finger pan measures the angle between neighbouring fingers in the plane of the palm, so a relaxed, spread palm rests and a bent finger doesn't count as spread.
- **A still hand doesn't move the map.** Dragging starts only once your hand leaves a small dead zone, and the dead zone comes back after you hold still.
- **No jerks when you change shape.** Pan and zoom only use frames that clearly show the pose, and re-anchor whenever they don't.
- **The click lands where you pointed.** The pointer freezes the moment your index starts to fold, and rewinds a little. A fold only clicks if it's deep enough and you lift it within about half a second. Hold it folded and it becomes a fist instead.
- **Holds, not flicks.** Fist, thumbs up and trained commands fire once, after a short hold. A ring around the pointer fills while you hold.
- **No accidental zoom.** Zoom only starts after your fingers have moved a little, and never in the split second while your hand changes shape.
- **Two hands win.** While both hands are in view, only rotation works, and there's a short grace period after you drop one.

Every threshold lives in one `DEFAULTS` object at the top of the engine. Pass overrides with `new Gestures.Engine({ holdMs: 400 })`.

## Tests

```bash
npm test
```

The tests drive the real engine with synthetic hands (`src/synth.js`) at 30 fps. They cover every gesture, tilted and noisy hands, the robustness rules above, and the trainer (recognition, fallback, left hands, look-alike reports, import/export). The same synthetic hand powers the **▶ Demo** button.

## Project structure

```
index.html            page shell; picks the city file
cities/               one file per city (bengaluru.js, london.js, _template.js)
src/gestures.js       gesture engine: landmarks in, map commands out
src/trainer.js        train-your-own gestures: k-nearest neighbours, look-alike check, save/load
src/explore.js        Explore mode: top-place lists, points, levels, badges
src/app.js            map drawing, UI, camera, mouse, touch, keyboard, demo
src/synth.js          synthetic hand generator for tests and the demo
src/style.css         styles
tools/csv-to-city.mjs CSV → city config converter
test/                 engine, trainer and Explore tests (node --test)
```

## Privacy

The camera feed is processed in your browser and never uploaded. Trained gestures are stored as hand-point coordinates (no images) in your browser's local storage. The MediaPipe library and model are downloaded from public CDNs when you turn on hand control.

## License

[MIT](LICENSE) © Anurag Raj. Use it, fork it, map your city. A link back is appreciated.

Bengaluru pins are approximate (usually within a few hundred metres), and venues change, so check before you head out.
