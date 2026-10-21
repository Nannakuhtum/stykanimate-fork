# Scripting animations (StykScript)

A StykScript is a text file that describes a stick animation: who is in it,
how they pose, where they stand, and when. An agent (or a person) writes it;
StykAnimate compiles it into an ordinary, editable project. The person watches
it in the desktop app's **Script** panel while the agent works, and answers
with notes the agent reads back from a file next to the script.

```
 agent ── writes ──▶ film.stykscript.json ── watched ──▶ StykAnimate (Script panel)
   ▲                                                         │
   └──── reads ◀── film.stykscript.review.json ◀── notes ────┘
```

## The loop

1. The agent writes `film.stykscript.json` (start from `npm run script -- new film.stykscript.json`).
2. `npm run script -- check film.stykscript.json` lists errors and warnings by line.
3. `npm run script -- preview film.stykscript.json` writes a contact sheet PNG of the key frames,
   drawn by the app's own evaluator, so the agent can look at its work without the app.
   `npm run script -- render film.stykscript.json` exports the finished film through the desktop
   app's own renderer and MP4 export (1080p by default), with optional stills.
4. `npm run script -- open film.stykscript.json` starts the desktop app with the script
   (or the person uses **Script › Open script…**). The script plays as a project; every time the
   file is saved, the project reloads in place at the same frame.
5. The person scrubs, selects a figure, optionally drags it into the pose they want, and
   adds a note in the **Notes** tab. The note records the frame, the script key, the figure
   and the script line, and with **Attach … pose** the figure's pose in script terms.
6. The agent runs `npm run script -- notes film.stykscript.json`, changes the script, and
   answers with `npm run script -- reply film.stykscript.json n1 "Raised the arm" --resolve`.
   The reply appears in the panel.

If the script has an error, the panel names the line and keeps showing the last version that
worked. If the person has edited the project in the app, a changed script waits behind a
**Reload** button instead of replacing their edits.

## Format

JSON, with `//` and `/* */` comments and trailing commas allowed. Frames start at **1**.
Directions are **degrees on screen: 0 right, 90 down, 180 left, -90 up**.

```jsonc
{
  "stykscript": 1,                 // required
  "title": "Duel",
  "canvas": "landscape",           // or "portrait", "square", "hd", or {"width": 960, "height": 540}
  "fps": 24,
  "background": "#f7f7f2",
  "ground": 440,                   // the floor's y, used by "y": "ground"
  "length": 84,                    // frames; default: the last entry + 12
  "defaults": {"ease": "smooth"},

  "poses": {                        // your own poses; "base" starts from another pose
    "guard": {"base": "ready", "armR": 100, "forearmR": -60}
  },

  "figures": {                      // stick figures and their state at frame 1
    "blue": {"name": "Blue", "color": "#0d99ff", "x": 120, "y": "ground", "pose": "stand"},
    "red":  {"color": "#e5484d", "x": 700, "y": "ground", "facing": "left", "pose": "guard"}
  },

  "props": {                        // lines and circles
    "floor": {"shape": "line", "from": [0, 440], "to": [960, 440], "color": "#2b2b2b", "thickness": 4},
    "ball":  {"shape": "circle", "r": 12, "x": 480, "y": 200, "color": "#f0a547"}
  },

  "timeline": [                     // entries in time order
    {"at": 1, "id": "open", "note": "Wide shot."},
    {"at": 7, "blue": {"pose": "walk1", "x": "+45", "y": "ground"}},
    {"at": "+6", "blue": {"pose": "walk2", "x": "+45", "y": "ground"},
     "camera": {"x": 520, "y": 300, "zoom": 1.35, "ease": "ease-in-out"}},
    {"at": 43, "id": "attack", "red": {"pose": {"armL": 0, "forearmL": 0}, "x": "-90", "ease": "ease-in"}}
  ]
}
```

### The figure

Every figure is Blue, the figure File › New starts with. Its `x`/`y` is the **hip joint**.
The torso and both thighs start at the hip; the head and both arms start at the top of the torso.
`npm run script -- rig` prints this table and the built-in poses.

| joint | from | length |
| --- | --- | --- |
| `torso` | hip | 78 |
| `head` | top of torso | 44 (a circle; the length is its diameter) |
| `armL`, `armR` | top of torso | 53 |
| `forearmL`, `forearmR` | elbow | 48 |
| `thighL`, `thighR` | hip | 66 |
| `shinL`, `shinR` | knee | 63 |

`L`/`R` are the figure's own sides (Blue's segments are named *Left upper arm* and so on in the
app). The app's segment names are accepted too.

`"hands": true` on a figure adds fists: a disc at the end of each forearm that turns with it. They
make contact (a handshake, a grip, a punch landing) much easier to read.

Poses are written **facing right** (toward +x). `"facing": "left"` mirrors the figure, so the same
pose works for both sides of a fight. `"rotate"` turns the whole figure about the hip, in degrees.

Built-in poses: `neutral`, `stand`, `ready`, `punch`, `kick`, `block`, `hit`, `crouch`, `jump`,
`walk1`, `walk2`, `run1`, `run2`, `fall`, `lie`, `sit`, `wave`, `cheer`.

### Entries

Each entry has `at` (a frame number, or `"+n"` frames after the previous entry) and changes any
of the figures and props by name, plus optionally the `camera`:

| key | meaning |
| --- | --- |
| `pose` | a pose name, or an object of joints. An object without `base` changes only the joints it names. |
| `x`, `y` | a number, or `"+n"`/`"-n"` from the figure's previous key. `"y": "ground"` stands the figure's lowest point on `ground`. |
| `reach` | aim hands and feet at scene points: `{"handR": [x, y], "footL": {"x": 430, "y": 491, "bend": "forward"}}`. Limbs: `handL`, `handR`, `footL`, `footR`. `bend` picks where the elbow or knee goes: `up`, `down` (arms' default), `left`, `right`, `forward` (legs' default) or `back`. Applied after `pose`, so the rest of the pose stays. Out of reach, the limb straightens toward the point and the checker says how far short it is. |
| `facing` | `"left"` or `"right"` |
| `rotate`, `scale` | whole-figure rotation in degrees (also `"+n"`), and size |
| `ease` | how this key moves to the next: `smooth` (default), `linear`, `ease-in`, `ease-out`, `ease-in-out`, `hold`; or `"bezier": [x1, y1, x2, y2]` |
| `camera` | `x`, `y` (the scene point to centre), `zoom`, `rotate`, `ease` |
| `id`, `note` | names the entry for notes and the panel, and says what it is for |

Anything not given carries over from the figure's previous key. A `reach` is solved into the key's
joint angles, so later keys carry the arm or leg where it was put unless they reach again. A figure only gets a key at the
entries that name it, so its motion is smooth across entries that move other figures. An `ease`
on the entry itself applies to everything in it that has no `ease` of its own.

Two figures that hold each other (a grip, a carry) each interpolate their own joints between
keys, so their hands drift apart during a fast, wide move. Key such moves on every frame or two;
`examples/scripts/arm-wrestle.gen.mjs` keys its rollover on every frame for this reason, and its
test checks the fists stay within 2.5 px of each other until the release.

Joints always turn the **short way round** between keys. Spins and flips need keys less than 180°
apart; the checker warns when a key would turn a joint almost exactly half a circle (the direction
is then a coin toss) or rotate a figure more than 180°.

### Depth and folders

| key (on a figure or prop) | meaning |
| --- | --- |
| `z` | stacking: lower is further back (default 0); ties keep script order. A prop with a `z` gets its own layer instead of joining the Set, so it can sit between figures (a table in front of a referee and behind the wrestlers' arms). |
| `group` | a layer folder name; figures and props with the same group sit together in that folder (a crowd, confetti). |

### What it becomes

Each figure and each moving prop gets its own layer, named after it; props that never move and
have no `z` share a **Set** layer at the back. Each script entry becomes a key on that layer with the entry's easing,
and camera entries become Camera keys, so the timeline shows the script's structure and everything
remains editable. Saving the project writes an ordinary `.styk` file; the script itself is not
changed by the app.

## Review notes

Notes live in `<script>.review.json` beside the script (for `film.stykscript.json`,
`film.stykscript.review.json`):

```json
{"stykreview": 1, "script": "film.stykscript.json", "notes": [
  {"id": "n1", "status": "open", "from": "person", "created": "2026-10-21T10:00:00.000Z",
   "text": "Make the rear arm swing up more before the punch.",
   "frame": 43, "entry": "windup", "figure": "red", "line": 36,
   "suggestion": {"at": 43, "red": {"pose": {"torso": -79.2, "armR": 146, "...": 0}, "x": 610, "y": 312, "facing": "left"}},
   "replies": [{"from": "agent", "text": "Raised the rear arm in \"windup\".", "at": "…"}]}
]}
```

`suggestion` is a timeline entry in script terms: the agent can paste it in or fold the joints it
cares about into an existing pose. `entry` is the key at that frame, or the latest one before it.
Both sides write by reading the latest file, applying one change and replacing the file
atomically, so notes and replies written at the same time are not lost.

## Command line

```
npm run script -- new <file>                    starter script
npm run script -- check <script>                errors/warnings with lines; exit 1 on errors
npm run script -- preview <script> [--frames 1,12,30] [--width 320] [--columns 4] [--svg] [--out f]
npm run script -- frame <script> <n> [--width 960] [--out f]
npm run script -- video <script> [--out film.mp4|film.gif] [--width 640]     quick preview (needs ffmpeg)
npm run script -- render <script> [--out film.mp4] [--size 1080|720|original] [--stills 1,60]
                                                the app's renderer and MP4 export (xvfb-run -a on a headless Linux)
npm run script -- compile <script> [--out f]   the project as .styk.json (File › Open opens it)
npm run script -- rig                           joints, lengths, built-in poses
npm run script -- notes <script> [--all] [--json]
npm run script -- reply <script> <note> <text> [--resolve]
npm run script -- open <script>                 the desktop app, live-reloading the script
```

The desktop app also accepts `--script=<path>` or a `*.stykscript.json` argument at launch.
Previews draw lines and circles only; they use the same poses, easing and camera as the app.

## Code

| Concern | Module |
| --- | --- |
| Parsing with line numbers | `src/script/jsonc.mjs` |
| Rig vocabulary, built-in poses, mirroring | `src/script/stick-rig.mjs` |
| Compiler (script → layers, keys, camera) | `src/script/compile.mjs` |
| Canvas pose → script terms | `src/script/capture.mjs` |
| Notes and their operations | `src/script/review.mjs` |
| Headless previews | `src/script/preview.mjs` |
| The panel | `src/script/script-panel.mjs`, `src/styles/features/script.css` |
| Watching files, review writes | `desktop/script-session.cjs` (`styk:script-*` IPC) |
| Command line | `scripts/styk-script.mjs`; `scripts/render-script.mjs` drives the app for `render` |
| Examples | `examples/scripts/duel.stykscript.json` (hand-written), `examples/scripts/arm-wrestle.gen.mjs` (generates `arm-wrestle.stykscript.json`) |

The compiler is pure: no DOM, workers or files. The panel replaces the script's project with
`editor.load()` (history starts over; the script is the source of truth), and only when the
project in front is the script's and has no unsaved edits.

## Verification

```sh
node --test tests/script.test.mjs
xvfb-run -a node scripts/smoke-script.mjs     # or without xvfb-run on a desktop
```

The smoke test launches the app with a script, edits the file, adds a note with a captured pose
through the panel, replies from the command line and checks that an error keeps the last good
version; screenshots go to `artifacts/script-smoke/`.

## Limits

- One rig (Blue) and two prop shapes. Other figures, sprites, text, effects and sound are not
  scriptable yet; they can be added in the app after compiling.
- A prop can't be hidden; keep it outside the shot until it is needed (the confetti waits above the frame).
- The side view is flat: things that happen toward or away from the camera, like the real direction
  of an arm-wrestling pin, have to be staged left/right.
- In the browser build the panel reads a picked file (polled for changes where the browser allows)
  and keeps notes in the window; **Copy notes** hands them to the agent.
