# Modifier Design Principles

These principles apply whenever a modifier is designed or built, by a person or by an agent working on its own. They say **what a good modifier must be**, not which steps to follow. The steps are defined separately (skills).

The principles are derived from the owner's requirements. Each one names the underlying need, the rule that follows from it, and the signs that the rule is being broken. When principles conflict, the earlier one wins.

---

## 1. See what you do

**Need:** The user wants to see the effect of a change while making it, where they make it. A value whose meaning has to be read from a label, a unit or a tooltip forces the user to translate text into light. That is bad UX.

**Rule:** Every adjustment MUST be made on a visual representation of its result. Prefer grabbing the thing itself (a shape, an edge, an area, a position) over setting an abstract value. A fader or number field is acceptable only for a quantity that has no visible position anywhere.

**Red flags**
- A control can only be understood from its description.
- The user has to change a value and then look somewhere else to find out what it did.
- A list of faders stands in for something that has a shape.

## 2. Manipulate things where they live

**Need:** Every concept already has a natural place where it is visible: space on the canvas, time on a time axis, color on a color surface. Mirroring it somewhere else splits attention and duplicates truth.

**Rule:** Edit spatial things in space (on the canvas, like a gradient tool), temporal things on a time representation, and colors on a color representation. Each concept has **one** primary representation. Do not add a second view of something the canvas already shows.

**Red flags**
- A mini stage or fixture preview inside the card.
- Direction, length or order typed into fields instead of drawn on the canvas.
- Two places that edit the same thing differently.

## 3. Reveal behaviour, not only the sample

**Need:** Real rigs are coarse. With a handful of fixtures the user only sees a few stepped values and cannot judge how the effect actually behaves.

**Rule:** When the stepped output hides the underlying behaviour, show the behaviour continuously, as if there were infinitely many pixels. Show it next to the editor that shapes it. This complements the canvas; it does not repeat it.

**Red flag:** The only way to understand the effect is to add more fixtures.

## 4. Think in looks, speak in looks

**Need:** Users think in stage pictures ("a dot runs along the row", "the front pair lights first", "candles flicker"). They do not think in algorithms or parameter names.

**Rule:** Design every modifier from concrete looks on real rigs and derive the controls from what those looks need. Name every control by the effect the user perceives, never by the implementation (e.g. *Coherence*, not *Perlin scale*; *Width*, not *duty*).

**Red flags**
- A choice between algorithms (white / perlin / step).
- Parameter names taken from the math.
- A control that no documented look needs.

## 5. The first result must be meaningful

**Need:** Adding a modifier should immediately produce something worth keeping. A no-op or an arbitrary result makes the user debug before they can design.

**Rule:** Defaults MUST produce a clearly visible, pleasing result on the current selection without any adjustment. Derive defaults from the selection (shape, extent, order, multi-head fixtures) and from the most common intent. Never use fixed magic numbers or neutral values that do nothing.

**Red flags**
- A fresh instance shows no change.
- A spread or size that ignores the selection.
- Defaults that differ visibly between a row and a ring for no reason.

## 6. Structure and contrast over uniform change

**Need:** Good lighting looks have structure: lit against dark, clearly readable waves, symmetric constellations. Uniformly changing everything rarely looks intentional.

**Rule:** Make contrast and structure the easy path. Floor/peak, width and spacing are first-class and directly adjustable. Symmetry and repetition are reachable with one action, not with arithmetic.

**Red flags**
- The obvious result is "everything slightly brighter/darker".
- Symmetry needs manual calculation.

## 7. Respect how the user describes the rig

**Need:** Users describe rigs by order and relation ("first the front pair, then the next", "inside each bar", "every other one"), not by coordinates. They also position imprecisely.

**Rule:** Support order, symmetry, grouping and the inner structure of multi-head fixtures as first-class concepts. Let the user express them the way they would explain them (click in sequence, draw a line through the rig). Tolerate imprecision: positions that are almost equal are treated as equal.

**Red flags**
- Coordinates or indices typed by hand.
- Symmetric fixtures getting different ranks because of a small offset.
- Bars treated as single points.

## 8. One control, one meaning

**Need:** If the user has to ask "what is the difference between these two?", the design has failed.

**Rule:** Every control has exactly one meaning that can be stated in one line, and no two controls overlap. Quantities that belong together are combined into one representation (principle 1) rather than spread over several controls. Presets set controls; they are not a parallel mechanism with similar names.

**Red flags**
- Two controls whose effects look alike.
- A preset row and a mode selector offering the same words.
- Settings scattered that the user always changes together.

## 9. Continuous where the difference is a spectrum

**Need:** Many discrete options are just points on a perceivable spectrum (independent ↔ coherent, free ↔ on beat, soft ↔ hard). Forcing a choice hides the space in between.

**Rule:** Replace categorical switches with continuous axes when the categories lie on one perceivable spectrum. Keep a discrete choice only when the options are genuinely different in kind. Every axis must correspond to a difference the user can see.

**Red flags**
- An enum whose options blend into each other.
- An axis whose extremes look the same.

## 10. Rare events are explicit

**Need:** Many natural looks are "mostly A, occasionally B" (a flicker dip, a sparkle, a dropout).

**Rule:** Model occasional events explicitly by how often and how long they happen, and make both directly adjustable. Do not emulate them through thresholds or side effects of other parameters.

## 11. Entry points are looks, then refine

**Need:** Users want to start from something finished and adjust it, not assemble from zero.

**Rule:** Every modifier offers named looks (recipes) that set *all* of its settings at once, including spatial distribution and tempo. Applying one is a single, undoable action. Fine-tuning afterwards uses the same controls as always.

**Red flag:** A recipe changes only some settings and leaves a mismatched rest.

## 12. Shared concepts look and behave the same everywhere

**Need:** Concepts like distribution, order, grouping, tempo, curves and color are learned once. If they differ between modifiers, the user must relearn and mistrusts the tool.

**Rule:** Shared concepts use the shared building blocks, identical in every modifier. A modifier **declares** which options it supports (which distribution modes, which shapes, which editors) and never reimplements them. New capabilities go into the shared block, so every modifier benefits.

**Red flags**
- Custom spatial controls in one modifier.
- The same concept with different names or layouts in two modifiers.

## 13. Declarative and generative

**Need:** Modifiers and their building blocks will be created by code and by AI. Shapes and options must be precise and adjustable, and they must also be producible programmatically.

**Rule:** Describe capabilities as data and parametric generators (shapes with arguments, presets, editor bindings), not as baked results. A parametric definition stays exact and adjustable. Converting it to free-form editing is an explicit user choice.

**Red flag:** A shape that can only be drawn by hand, or a preset that only exists as a frozen point list.

## 14. Nothing essential is hidden

**Need:** Hiding frequently used or spatial settings makes them undiscoverable and breaks principle 2.

**Rule:** "More" holds only rarely used refinements. Anything tied to the canvas, anything a recipe changes visibly, and anything needed for a documented look stays visible.

**Red flag:** Users open "More" for an everyday look.

## 15. Continuity: never regress

**Need:** Users rely on what they know: names, capabilities, look and placement. A redesign that removes or silently changes these feels like breakage.

**Rule:** Keep established names, capabilities and the visual appearance of existing controls unless a change is explicitly requested. A new design must be at least as direct as the best previous design for the same job. Existing projects keep working and keep their look.

**Red flags**
- A renamed concept nobody asked to rename.
- A capability that is gone.
- A restyled control after a refactor.
- An old project that opens differently.

## 16. Calm, stable interface

**Need:** The workspace is a tool used under time pressure, often live. Layout shifts and overflow destroy trust.

**Rule:** Content never widens or shifts panels and dialogs; long text truncates. New items appear where users already look for them, in the existing information architecture. Everything stays operable at the sidebar's width.

**Red flag:** A long name pushes buttons out of view.

## 17. One language

**Rule:** All user-facing text (labels, recipe names, tooltips, hints) is **English**, regardless of the language a requirement was written in.
