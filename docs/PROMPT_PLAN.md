# Cooking Sim — Prompt Plan (Phase 1: Full Kitchen)

## Context
Greenfield repo (no commits). The game is a drag-around cooking sim: there is **no player character**. The camera looks straight ahead and slides along the kitchen as you drag the background; you drag objects (steak, pans, knife, flour bag) with weighty physics. Phase 1 delivers every cooking appliance and a true-to-life food simulation. This document is a sequence of self-contained prompts to feed Claude Code one at a time; each ends with acceptance checks so progress is verifiable before moving on.

## Recommended stack (assumption — change in Prompt 0 if you disagree)
- TypeScript + Vite, browser game (playable from any device, easy to verify with the preinstalled Playwright/Chromium).
- Three.js rendering, **Rapier** (WASM) rigid-body physics.
- Pure-TS **simulation core** (`src/sim/`) with no Three/Rapier imports, unit-tested with Vitest. Rendering/physics read from it.
- Mouse + touch via Pointer Events (one code path).

## Architecture rules (apply to every prompt)
1. **Sim vs. view split:** cooking math lives in `src/sim`, deterministic, fixed timestep, testable headless.
2. **Data-driven:** foods, cookware, appliances defined in `src/data/*.ts` (thermal properties, mass, cook curves), not hardcoded in logic.
3. **Input rule:** pointer-down on an object = grab it; pointer-down on empty space = pan camera. Camera never rotates.
4. **Time:** a game-time multiplier (1x / 5x / 20x) is built in from the start so slow cooks (ribs, sous vide) are playable.
5. Each prompt ends with: tests pass, `npm run build` passes, a Playwright screenshot of the new feature, commit on branch `claude/eloquent-wright-mrttfj`.

---

## Prompt 0 — Scaffold
Create a Vite + TypeScript project with Three.js, Rapier, Vitest, ESLint. Folder layout: `src/{engine,sim,data,world,ui}`. Fixed-timestep loop (physics 120 Hz, sim 30 Hz), a debug overlay (FPS, body count), and a Playwright smoke script that loads the page and screenshots it.
**Accept:** `npm run dev`, `build`, `test` all work; smoke screenshot shows an empty lit scene.

## Prompt 1 — Drag-to-pan camera
Perspective camera locked facing forward (−Z). Dragging background translates the camera on X (and a small Y range for reaching high shelves/lower drawers); dragging left moves the view left, never rotates. Add inertia/damping, edge clamping to kitchen bounds, and optional wheel/pinch for small Z dolly. Expose `CameraRig` with `panBy`, `bounds`, `focusOn(point)`.
**Accept:** unit test for clamping/inertia; screenshot sequence shows lateral movement with unchanged orientation.

## Prompt 2 — Physics grabbing with weight
Raycast to pick a rigid body on pointer-down; drag with a **spring-damper force toward a pointer target on a depth plane**, capped by a max force so heavy items (cast-iron pan, pot of water) lag and swing while light items (herbs) snap. Add: hold-height lift, throw on release, per-object mass/friction/restitution from data, collision sounds hook, and "can't lift through counters" via collisions. Scroll/two-finger gesture rotates the held item (to flip a steak with tongs or by wrist-flick).
**Accept:** headless physics test: heavier body reaches target slower under same force cap; held body can't tunnel through the counter.

## Prompt 3 — Kitchen shell and stations
Build a wide kitchen (~4–5 screen widths) as modeled primitives with colliders: left→right = pantry/fridge, prep counter + cutting board, stovetop range with oven below, grill/flat-top, fryer, air-fryer, sous vide tub, sink, plating counter. Static colliders, countertop materials, warm lighting, soft shadows. Stable spawners (fridge shelves, pantry bins) that hand out items on drag-out.
**Accept:** panning across the whole kitchen; objects rest stably on every surface at 60 FPS.

## Prompt 4 — Food thermal simulation core (the heart of the game)
In `src/sim`, implement a `FoodItem` as a coarse 3D grid (e.g. 12×8×12 voxels/slab layers) with per-cell: temperature, moisture, and per-surface-face browning/char accumulators.
- **Heat transfer:** conduction between cells (thermal diffusivity per food), contact conduction with pan/grill (by contacting surface fraction), convection (oven/air-fryer airflow coefficient, water/oil bath coefficients — sous vide and fry are far higher than air), radiation (grill/broiler).
- **Protein/starch stages by internal temp:** meat color + texture thresholds (rare ~120–125°F, medium-rare 130–135, medium 140–145, medium-well 150–155, well ≥160); moisture/juice loss ramps as proteins denature (~120–140°F myosin, ~150–165°F actin); collagen → gelatin for ribs/brisket (190–203°F over hours); starch gelatinization for potatoes/pasta.
- **Surface chemistry:** Maillard browning accumulates above ~285–300°F surface temp (faster when dry); **char/burn accumulates per face** when a face stays above ~400°F+ for a long time — so un-flipped meat chars on that side only. Moisture at the surface delays browning (steaming) until it evaporates.
- **Carryover cooking** and resting redistribute temperature; overcooking is irreversible.
- Safety state (chicken/pork 165°F target) tracked for feedback only, not a fail screen.
**Accept:** Vitest cases — 1.5" steak on 450°F pan, flipped at 3 min vs. never flipped (char on one face only); sous vide at 131°F for 2h reaches uniform 131°F core; resting raises core ≥ 3–5°F; overcooked steak reports well-done core even if cooked briefly at high heat then long at low.

## Prompt 5 — Food rendering and cross-section
Render foods with a shader fed by sim state: base color lerp (raw→browned→charred) per face, wetness/sheen, shrink with moisture loss. **Cut surfaces** render a cross-section texture sampled from the interior temperature/moisture grid at the cut plane: red/pink/gray bands with a realistic gradient (gray-brown band near the seared edge, pink center for rare, uniformly gray for well-done — and an overcooked steak looks well-done inside even if the outside looks fine). Add **juices**: a particle/metaball fluid emitted on cutting, amount ∝ remaining moisture and recent rest time (less if rested long, none if dry), color from myoglobin state (red→clear/brown), pooling on the board.
**Accept:** side-by-side screenshot of rare vs. medium vs. well-done vs. overcooked-flipped-too-late steak cut open.

## Prompt 6 — Appliances: heat sources
Data-driven appliances sharing a `HeatSource` interface (surface temp curve, response lag, power, fuel/electric):
- **Stovetop** (4 burners, drag-rotated knobs, low→high, simmer/boil behavior) with pan/pot sitting physically on grates; **flat-top/griddle**.
- **Grill** (gas/charcoal feel): zonal heat, grill-mark contact pattern on food faces, flare-ups from dripping fat, lid on/off.
- **Oven:** door opens by dragging, rack heights, preheat curve, setpoint dial, bake/broil, convection fan toggle, internal thermostat cycling ±.
- **Air fryer:** basket pulled by handle, temp/time dials, high-velocity convection.
- **Sous vide:** water tub with circulator clamp, setpoint dial, bag with sealed food submerged (buoyancy/ displacement), very slow equalization.
Show each appliance's real temperature on a physical dial/digital readout.
**Accept:** each appliance heats to setpoint with realistic lag; oven preheat ~10–15 game-min; dialing a burner changes pan surface temp measurably in sim.

## Prompt 7 — Cookware and liquids
Pan (nonstick + stainless/cast iron variants with different thermal mass and hot spots), pot, baking sheet, sauté pan, sheet-pan with rack, bowls, fry basket. Cookware holds contents: oil film in pans (smoke point behavior), water in pots (boil at 212°F, evaporation, boil-over if left covered high), lids, handles (drag by handle to tilt/pour). Liquid pouring: lightweight particle/heightfield fluid that transfers volume between containers. Heat in cookware is simulated (thermal mass), feeding food contact temp.
**Accept:** water in a pot reaches a rolling boil in plausible time; cast iron holds heat after burner off; oil smokes past its smoke point.

## Prompt 8 — Proteins: steak, chicken, ribs
Define data for ribeye/strip steak (various thicknesses), chicken breast/thighs/whole, pork ribs/short ribs: mass, shape (slab/bone), fat cap, moisture, collagen. Include seasoning interaction (salt draws surface moisture, pepper/spices burn at high heat), fat rendering + drip (flare-ups on grill), bone insulation. Add a **probe thermometer** item you can stab in and read the core. Ribs: low-and-slow oven/smoker-style ≈ 225–275°F for hours with fall-off-bone transition, wrapped/unwrapped variants.
**Accept:** cooking tests for each; chicken undercooked state is visually and thermometrically distinguishable from done.

## Prompt 9 — Knife and cutting (physics-based but forgiving)
Grabbable knife: dragging the blade down through a held-down item cuts when the blade is moving fast enough and roughly aligned; use a **swept-blade intersection against a mesh/voxel slicer** that splits the item into 2 rigid bodies with correct mass split, new capped faces, and cross-section data from the sim grid. "Easier to cut" assist for vegetables: magnetic alignment to the nearest cut line, soft resistance so slices land even. Meat cutting with resistance depending on doneness (raw = tough, rested well = tender). Cut pieces keep their temperature state per cell.
**Accept:** potato → slices with consistent thickness under slightly sloppy input; steak cut shows cross-section + juices from Prompt 5.

## Prompt 10 — Auto-cutter
A mandoline/hopper-style station: drop a whole vegetable in, pick thickness/shape via a dial (slices, matchsticks/fries, wedges, dice), crank/press handle to cut. Outputs rigid pieces with correct count/size/mass. Grids are pre-computed per shape for performance; pieces spawn physically into a bowl below.
**Accept:** potato → fries (⅜") or wedges output in a bowl; dial positions change output geometry.

## Prompt 11 — Vegetables, potatoes, pasta, spices
Vegetables (onion, carrot, pepper, broccoli, mushroom, etc.) with water/starch/sugar parameters: softening curve, caramelization >~320°F surface sugars, steaming. Potatoes: boil/roast/fry states (starch gelatinization, crisp skin/fry crust). **Pasta:** dry→water absorption→al dente→mushy over 8–11 min of boiling, sticks/clumps if not stirred, starchy water; colander drain with physics. **Spices:** shakers (drag/flick to shake particles), salt, pepper, paprika, garlic powder, chili flakes, dried herbs; spice particles adhere to surfaces, add flavor tags, burn if too hot, salt draws moisture.
**Accept:** pasta al dente window test; roasted potatoes get crisp edges at 425°F; garlic burns when sautéed too hot.

## Prompt 12 — Frying: fryer and oil in a pot
**Deep fryer** appliance with basket + oil temp control (smart to 350–375°F, drops when food added, recovers by power). Also allow **pouring oil from a bottle into any pot** and using it as a fry bath (temperature from the stove, boil-over/splatter risk with wet food, fire if oil passes smoke/flash point and gets ignited). Food in oil: surface moisture flashes to steam, crust forms (crispness), oil absorption, color progression; fries double-fry for best result. Splash/bubble particles; oil level displacement.
**Accept:** fries blanched at 325°F then fried at 375°F get higher crispness than single fry; oil temp dips when basket is lowered and recovers.

## Prompt 13 — Baking and pantry
Pantry: flour, sugar, salt, baking powder/soda, yeast, butter, eggs, milk, oil, vanilla, chocolate chips. Granular ingredients behave as heavy particle piles you scoop with cups/spoons or pour from bags; bowls track composition. Mixing: stir with spoon/whisk — mix quality rises with stroke count; a **recipe-less "emergent" dough/batter state** based on ratios (hydration, fat, leavening), enough to make: bread/pizza dough, cookies/biscuits, basic cake batter. Oven baking: rise (yeast/CO₂), set, browning, burn; underbake raw center vs. overbake dry crumb via the same thermal grid. Rolling pin & knife for shaping.
**Accept:** a basic bread dough rises and bakes at 425°F to a plausible crumb/crust; too-wet vs. too-dry dough give distinguishable outcomes.

## Prompt 14 — HUD, feedback, and hands-on tools
Minimal diegetic UI: knob labels, oven display, kitchen timer, probe thermometer readout, a tongs/spatula tool (flip by dragging under and rotating), oven mitt for hot items (burn feedback when grabbing hot cookware barehanded), time-scale control, pause. Sizzle / boil / smoke / knife audio with volume tied to sim intensity (sizzle ∝ moisture × surface temp). Smoke alarm when smoke accumulates. Plating station with a score-free "how did it turn out" inspector card (doneness label, char %, juiciness, internal temp).
**Accept:** end-to-end playthrough in Playwright: grab a steak, sear both sides, rest, cut, view cross-section + juices.

## Prompt 15 — Integration, performance, and balance pass
Profile with 40+ rigid bodies and several foods simulating at once; LOD the sim grids for off-screen items, sleep inactive bodies, pool particle systems. Mobile touch tuning (grab threshold, big hit targets). Tuning pass over all cook curves with a table of reference cook times/temps in `docs/cooking-reference.md` and tests tied to it. Save/load kitchen state to localStorage.
**Accept:** ≥60 FPS desktop / ≥30 FPS mid mobile in a stress scene; `npm test` covers every food/appliance against the reference table.

---

## Verification (end-to-end, after Prompt 15)
1. `npm test` — all sim unit tests green (steak doneness/char, sous vide, pasta, oil temp, dough).
2. `npm run build` — no type errors.
3. Playwright scripts (using preinstalled Chromium) drive the game:
   - Pan test: drag background left → camera x decreases, orientation unchanged.
   - Steak test: sear 3 min/side vs. one side 8 min → screenshot char difference; cut open → cross-section + juices.
   - Fry test: fries into 375°F oil → crisp state in inspector.
   - Bake test: dough in 425°F oven → baked loaf.
4. Manual play in browser: feel of heavy vs. light items, cutting leniency on vegetables vs. meat, appliances' dial interactions.

## Open questions to settle at the start of Prompt 0
- Web (Three.js + Rapier) as recommended, or Unity/Godot?
- Realistic-low-poly art style vs. stylized? (Plan assumes stylized-realistic primitives so the cooking visuals carry the game.)
- Imperial °F (used above) vs. °C display toggle — recommend both.
