# Advanced Reveal.js Features

These features are available if the user specifically requests them. They are not used by default.

## Fragments (Progressive Reveal)

Show content step-by-step on click:

```html
<p class="fragment">Appears on click</p>
<p class="fragment fade-up">Slides up</p>
<p class="fragment highlight-red">Turns red</p>
```

Fragment animations:
- `fade-in` (default)
- `fade-out`
- `fade-up`, `fade-down`, `fade-left`, `fade-right`
- `highlight-red`, `highlight-green`, `highlight-blue`
- `strike` (strikethrough)

### Custom brand fragments

Two extra fragment styles ship in `base-styles.css` for a more polished build-up:

- `rise` — fades up from below with a subtle de-blur (text, cards, stat blocks)
- `pop` — scales in with a gentle overshoot (pills, badges, big numbers)

```html
<p class="fragment rise">Rises and de-blurs in</p>
<div class="stat fragment rise">…</div>
<p class="pill fragment pop">Pops in</p>
```

Tune the feel by editing the `transition` duration on `.reveal .fragment.rise` / `.pop` in `styles.css`.

### Slide pacing

For a calmer, more cinematic deck, set these in `Reveal.initialize`:

```javascript
Reveal.initialize({
  transition: 'slide',          // per-slide override with data-transition="fade|zoom|…"
  transitionSpeed: 'slow',      // 'default' | 'fast' | 'slow'
  backgroundTransition: 'fade', // crossfade color-block backgrounds (on-purple/on-pink)
});
```

Pair `backgroundTransition: 'fade'` with the color-block slides so the purple/pink backgrounds dissolve into each other.

**Prefer one transition for the whole deck.** A single global `transition` (set in `Reveal.initialize`) reads as more polished than a mix of per-slide effects; reserve per-slide `data-transition` overrides for deliberate emphasis, not variety for its own sake.

## Fragment-driven animations (state machines & sequential builds)

Fragments aren't only for revealing text — you can pace richer animations with them: build a diagram up piece by piece, or step the *same* elements through changing states on each click. Two reusable patterns.

### Sequential build-up (reveal layout items in place)

Make each item in a row/grid its own `.fragment` so the layout assembles one click at a time. Because hidden fragments use `visibility: hidden` (not `display: none`), **every item keeps its layout slot from the start** — items fade into their final position instead of shoving the others around. Group elements that belong together (e.g. a connector arrow + the box it points to) under the same `data-fragment-index`:

```html
<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
  <div class="card fragment rise" data-fragment-index="1">…</div>
  <div class="card fragment rise" data-fragment-index="2">…</div>
  <div class="card fragment rise" data-fragment-index="3">…</div>
  <div class="card fragment rise" data-fragment-index="4">…</div>
</div>
```

### State machine (CSS transitions driven by fragment events)

When the *same* elements change on each click (bars resize, colors shift, icons swap), don't reveal new DOM — keep one container and flip a `data-*` attribute on it, then let CSS transitions do the work. Drive the attribute from hidden fragment "triggers" plus Reveal's fragment events:

```html
<section id="scene">
  <div id="machine" data-state="0"> … diagram styled by [data-state] … </div>
  <!-- invisible triggers: each click advances the state -->
  <span class="fragment step" style="position:absolute; width:0; height:0; overflow:hidden;"></span>
  <span class="fragment step" style="position:absolute; width:0; height:0; overflow:hidden;"></span>
</section>
```

```javascript
const slide = document.getElementById('scene');
const machine = document.getElementById('machine');
function sync() {                       // derive state from how many triggers are visible
  machine.dataset.state = slide.querySelectorAll('.step.visible').length;
}
Reveal.on('fragmentshown',  e => { if (slide.contains(e.fragment)) sync(); });
Reveal.on('fragmenthidden', e => { if (slide.contains(e.fragment)) sync(); });
Reveal.on('slidechanged',   e => { if (e.currentSlide === slide) sync(); });
Reveal.on('ready',          e => { if (e.currentSlide === slide) sync(); });
```

```css
#machine .bar { transition: height .6s cubic-bezier(.22,1,.36,1), background-color .5s; }
#machine[data-state="1"] .bar.lead { height: 90%; background: var(--primary-color); }
/* …one rule-set per state… */
```

Gotchas worth knowing:
- **Derive state from the DOM, don't count clicks.** Counting `.visible` triggers makes the animation land correctly whether the viewer steps forward, steps back, or jumps straight into the slide (forward entry → 0 shown; backward entry → all shown).
- **`event.fragment` is the *first* element of its `data-fragment-index` group**, not necessarily the one you care about. Gate listeners on `slide.contains(e.fragment)`, not on the fragment's own class/id.
- **Mixed fragments coexist.** Real content fragments and invisible triggers can share a slide — give them explicit `data-fragment-index` values so the order is unambiguous.

### Verifying animated slides

`decktape` captures **one frame per slide, at its final fragment state** — so a build-up shows up fully assembled and intermediate steps never reach the PDF. To check in-between states, step through in a browser, or drive the deck and screenshot each step (`Reveal.slide(h, v, fragmentIndex)` jumps to an exact step; `Reveal.next()` advances one). If a slide uses an *auto-playing* (timed) animation rather than click-driven fragments, add an "export-mode" guard (detect `?export` in the URL) that snaps it to the finished state so the static capture isn't caught mid-animation.

## Speaker Notes

Add private notes visible only in speaker view (press `S` to open):

```html
<section>
  <h2>Slide Title</h2>
  <p>Visible content</p>
  <aside class="notes">
    Private notes for the presenter.
    - Remember to mention X
    - Transition to next topic
  </aside>
</section>
```

## Backgrounds

### Solid Color
```html
<section data-background-color="#283b95">
```

### Image
```html
<section data-background-image="image.jpg">
<section data-background-image="image.jpg" data-background-opacity="0.5">
<section data-background-image="image.jpg" data-background-size="contain">
```

### Gradient
```html
<section data-background-gradient="linear-gradient(to bottom, #283b95, #17b2c3)">
<section data-background-gradient="radial-gradient(#283b95, #17b2c3)">
```

## Auto-Animate

Automatically animate elements between slides. Elements with matching `data-id` attributes will transition smoothly:

```html
<section data-auto-animate>
  <h1>Title</h1>
</section>
<section data-auto-animate>
  <h1>Title</h1>
  <h2>Subtitle appears with animation</h2>
</section>
```

More complex example with matching elements:

```html
<section data-auto-animate>
  <div data-id="box" style="width: 100px; height: 100px; background: blue;"></div>
</section>
<section data-auto-animate>
  <div data-id="box" style="width: 300px; height: 150px; background: red;"></div>
</section>
```

## Transitions

Set per-slide transitions:

```html
<section data-transition="fade">
<section data-transition="slide">
<section data-transition="convex">
<section data-transition="concave">
<section data-transition="zoom">
<section data-transition="none">
```

Different in/out transitions:
```html
<section data-transition="slide-in fade-out">
```

## Slide Visibility

Hide slides from normal flow (accessible via URL only):
```html
<section data-visibility="hidden">
```

Skip slides in navigation but keep visible:
```html
<section data-visibility="uncounted">
```

## Code Highlighting

Basic syntax highlighting:
```html
<pre><code class="language-python">
def hello():
    print("Hello")
</code></pre>
```

Supported languages: `javascript`, `python`, `html`, `css`, `java`, `ruby`, `go`, `rust`, `sql`, `bash`, `json`, `yaml`, and many more.

**Line highlighting (step-through on click):**
```html
<pre><code data-line-numbers="1-2|3|4">
let a = 1;
let b = 2;
let c = x => 1 + 2 + x;
c(3);
</code></pre>
```

This highlights lines 1-2 first, then line 3 on click, then line 4.

**Static line highlighting (no step-through):**
```html
<pre><code data-line-numbers="3,5-7">
...
</code></pre>
```
