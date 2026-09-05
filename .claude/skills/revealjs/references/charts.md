# Adding Charts to Reveal.js Presentations

Charts are added using the [reveal.js-plugins/chart](https://github.com/rajgoel/reveal.js-plugins) plugin, which integrates Chart.js into your slides.

## Setup

The chart plugin is included by default in the scaffold. It adds these to your HTML:

```html
<!-- In <head> -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<!-- Before Reveal.initialize() -->
<script src="https://cdn.jsdelivr.net/npm/reveal.js-plugins@latest/chart/plugin.js"></script>

<!-- In Reveal.initialize() -->
Reveal.initialize({
  plugins: [ RevealChart ],
  chart: {
    defaults: {
      color: 'rgba(15, 23, 42, 0.6)',
      borderColor: 'rgba(15, 23, 42, 0.1)',
      font: { family: "'IBM Plex Sans', Helvetica, sans-serif", size: 13 },
      animation: { duration: 1400, easing: 'easeOutQuart' }
    }
  }
});
```

## Chart styling

The scaffold already sets deck-wide chart defaults (IBM Plex font, ink-toned text, faint grid, a slower draw) via `chart.defaults` in `Reveal.initialize` — see Setup above. On top of that, follow these per-chart conventions so a chart reads as part of the deck, not stock Chart.js:

**Dataset colors** — use the theme palette (the neutral default below; swap for the deck's colors):
- Primary series: `#2563eb` (line/border) with a soft fill `rgba(37, 99, 235, 0.14)`.
- Secondary series: `#14b8a6`. To de-emphasise a declining/context series, make it a **dashed line with no fill** (`"borderDash": [6, 6]`, `"fill": false`).
- Third / fourth: `#3b82f6`, slate `#0f172a`.

**Axes & legend** — keep them quiet:
- Hide vertical gridlines (`"x": { "grid": { "display": false } }`), fade horizontal ones (`"color": "rgba(15,23,42,0.07)"`).
- Drop the y-axis border, mute tick colors to `rgba(15,23,42,0.55)`.
- Legend at the bottom with `"usePointStyle": true` + `"pointStyle": "circle"` for clean round markers.
- Smooth lines with `"cubicInterpolationMode": "monotone"` (no overshoot below the data).
- Markers: accent-colored points with white rings (`"pointBorderColor": "#ffffff"`, `"pointBorderWidth": 2`).

**Full line-chart example** (solid filled "hero" series + dashed context series):

```html
<div style="position: relative; min-height: 0; min-width: 0;">
  <canvas data-chart="line">
  <!--
  {
    "data": {
      "labels": ["2022", "2023", "2024", "2025", "2026", "2027"],
      "datasets": [
        {
          "label": "Agent-authored",
          "data": [5, 12, 28, 46, 64, 80],
          "borderColor": "#2563eb",
          "backgroundColor": "rgba(37, 99, 235, 0.14)",
          "fill": true,
          "cubicInterpolationMode": "monotone",
          "borderWidth": 4,
          "pointBackgroundColor": "#2563eb",
          "pointBorderColor": "#ffffff",
          "pointBorderWidth": 2,
          "pointRadius": 5
        },
        {
          "label": "Human-authored",
          "data": [95, 88, 72, 54, 36, 20],
          "borderColor": "#14b8a6",
          "fill": false,
          "cubicInterpolationMode": "monotone",
          "borderWidth": 3,
          "borderDash": [6, 6],
          "pointBackgroundColor": "#14b8a6",
          "pointBorderColor": "#ffffff",
          "pointBorderWidth": 2,
          "pointRadius": 4
        }
      ]
    },
    "options": {
      "maintainAspectRatio": false,
      "plugins": {
        "legend": {
          "position": "bottom",
          "align": "start",
          "labels": { "usePointStyle": true, "pointStyle": "circle", "boxWidth": 8, "boxHeight": 8, "padding": 18, "color": "#0f172a" }
        }
      },
      "scales": {
        "y": {
          "beginAtZero": true, "max": 100,
          "border": { "display": false },
          "grid": { "color": "rgba(15, 23, 42, 0.07)", "drawTicks": false },
          "ticks": { "color": "rgba(15, 23, 42, 0.55)", "padding": 10, "stepSize": 25 },
          "title": { "display": true, "text": "% of total", "color": "rgba(15, 23, 42, 0.55)" }
        },
        "x": {
          "border": { "color": "rgba(15, 23, 42, 0.15)" },
          "grid": { "display": false },
          "ticks": { "color": "rgba(15, 23, 42, 0.55)", "padding": 8 }
        }
      }
    }
  }
  -->
  </canvas>
</div>
```

For bar / pie / doughnut, use the palette below for `backgroundColor`.

## Progressive reveal (one series per click)

To disclose a multi-series chart one line/dataset at a time as you click (e.g. show the baseline, *then* the series that overtakes it):

1. Mark each dataset `"hidden": true` in the JSON so the chart opens as bare axes.
2. Add one invisible fragment trigger per reveal step (see the fragment state-machine pattern in [advanced-features.md](advanced-features.md)).
3. On the fragment events, show/hide datasets by index with Chart.js's animated `chart.show(i)` / `chart.hide(i)`:

```javascript
const slide  = document.getElementById('chart-slide');
const canvas = slide.querySelector('canvas');
function render() {
  const chart = Chart.getChart(canvas);          // the plugin registers the instance here
  if (!chart) return;
  const shown = slide.querySelectorAll('.step.visible').length;
  [0, 1].forEach((i, idx) => {                    // dataset 0 at step 1, dataset 1 at step 2, …
    const want = shown > idx;
    if (chart.isDatasetVisible(i) !== want) want ? chart.show(i) : chart.hide(i);
  });
}
Reveal.on('fragmentshown',  e => { if (slide.contains(e.fragment)) render(); });
Reveal.on('fragmenthidden', e => { if (slide.contains(e.fragment)) render(); });
Reveal.on('slidechanged',   e => { if (e.currentSlide === slide) render(); });
```

4. **Progressive legend** — a hidden dataset still shows a struck-through legend label, which spoils the reveal. Drop labels for hidden datasets with a global default set once, before the chart builds:

```javascript
Chart.defaults.plugins.legend.labels.filter = item => !item.hidden;
```

Two gotchas with the reveal.js-chart plugin specifically:
- **It replays its entry animation on every `slidechanged`** by clearing the datasets and restoring them ~500ms later — which re-applies your `"hidden": true` and wipes the visibility you set. Re-run `render()` *after* that restore (e.g. `Reveal.on('slidechanged', e => { if (e.currentSlide === slide) { render(); setTimeout(render, 650); } })`) so your reveal state wins on (re-)entry.
- **Static export** (`?export`) captures one frame per slide, and a half-revealed chart looks broken in the PDF — so force all datasets visible when `window.location.search.includes('export')`.

## Chart Types

**Supported types:** `line`, `bar`, `pie`, `doughnut`, `radar`, `polarArea`, `bubble`, `scatter`

For most presentations, you'll use:
- **bar** - Comparing categories
- **line** - Trends over time
- **pie/doughnut** - Parts of a whole
- **scatter** - Relationships between variables

## Chart Sizing (IMPORTANT)

Charts MUST use one of these four layout options to properly fill their space without overflow:

1. **Full slide** - Chart fills entire slide below title
2. **Half slide (horizontal)** - Chart on left or right, content on the other side
3. **Half slide (vertical)** - Chart on top or bottom, content on the other half
4. **Quarter slide** - Chart in one quadrant, other content in remaining three

### Required CSS Pattern

Every chart needs:
1. **Flexbox section** with `display: flex; flex-direction: column; height: 100%;`
2. **Container div** with `flex: 1; position: relative; min-height: 0;` (and `min-width: 0` for grid layouts)
3. **`maintainAspectRatio: false`** in chart options

### Full Slide Layout

```html
<section style="display: flex; flex-direction: column; height: 100%;">
  <h2>Chart Title</h2>
  <div style="flex: 1; position: relative; min-height: 0;">
    <canvas data-chart="bar">
    <!--
    {
      "data": {
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "datasets": [{
          "label": "Revenue",
          "data": [45, 52, 61, 78],
          "backgroundColor": "#2196F3"
        }]
      },
      "options": {
        "maintainAspectRatio": false
      }
    }
    -->
    </canvas>
  </div>
</section>
```

### Half Slide - Horizontal (Left/Right)

Chart on right, content on left:

```html
<section style="display: flex; flex-direction: column; height: 100%;">
  <h2>Chart Title</h2>
  <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; min-height: 0; min-width: 0;">
    <div style="display: flex; flex-direction: column; justify-content: center; background: #f5f5f5; padding: 20px; border-radius: 8px;">
      <p><strong>Key Points</strong></p>
      <ul>
        <li>First insight</li>
        <li>Second insight</li>
        <li>Third insight</li>
      </ul>
    </div>
    <div style="position: relative; min-height: 0; min-width: 0;">
      <canvas data-chart="pie">
      <!--
      {
        "data": {
          "labels": ["A", "B", "C"],
          "datasets": [{
            "data": [45, 35, 20],
            "backgroundColor": ["#2196F3", "#4caf50", "#ff9800"]
          }]
        },
        "options": {
          "maintainAspectRatio": false
        }
      }
      -->
      </canvas>
    </div>
  </div>
</section>
```

### Half Slide - Vertical (Top/Bottom)

Content on top, chart on bottom (equal halves):

```html
<section style="display: flex; flex-direction: column; height: 100%;">
  <h2>Chart Title</h2>
  <div style="flex: 1; display: grid; grid-template-rows: 1fr 1fr; gap: 20px; min-height: 0; min-width: 0;">
    <div style="display: flex; align-items: center; justify-content: center; background: #f5f5f5; padding: 20px; border-radius: 8px;">
      <div>
        <p><strong>Analysis Summary</strong></p>
        <p>Description of what the chart shows and key takeaways.</p>
      </div>
    </div>
    <div style="position: relative; min-height: 0; min-width: 0;">
      <canvas data-chart="line">
      <!--
      {
        "data": {
          "labels": ["Jan", "Feb", "Mar", "Apr"],
          "datasets": [{
            "label": "Trend",
            "data": [10, 25, 35, 50],
            "borderColor": "#2196F3",
            "fill": false
          }]
        },
        "options": {
          "maintainAspectRatio": false
        }
      }
      -->
      </canvas>
    </div>
  </div>
</section>
```

### Content Header + Chart Below (Unequal Split)

Small content area on top (1/4 or 1/3), chart fills the rest. Use explicit fractions for predictable sizing:

**1/4 content, 3/4 chart:**
```html
<section style="display: flex; flex-direction: column; height: 100%;">
  <h2>Chart Title</h2>
  <div style="flex: 1; display: grid; grid-template-rows: 1fr 3fr; gap: 20px; min-height: 0; min-width: 0;">
    <div style="display: flex; align-items: center; background: #f5f5f5; padding: 15px 20px; border-radius: 8px;">
      <p><strong>Key insight:</strong> Revenue grew 25% quarter-over-quarter, exceeding targets.</p>
    </div>
    <div style="position: relative; min-height: 0; min-width: 0;">
      <canvas data-chart="bar">
      <!--
      {
        "data": {
          "labels": ["Q1", "Q2", "Q3", "Q4"],
          "datasets": [{
            "label": "Revenue",
            "data": [45, 52, 61, 78],
            "backgroundColor": "#2196F3"
          }]
        },
        "options": {
          "maintainAspectRatio": false
        }
      }
      -->
      </canvas>
    </div>
  </div>
</section>
```

**1/3 content, 2/3 chart:**
```html
<section style="display: flex; flex-direction: column; height: 100%;">
  <h2>Chart Title</h2>
  <div style="flex: 1; display: grid; grid-template-rows: 1fr 2fr; gap: 20px; min-height: 0; min-width: 0;">
    <div style="display: flex; flex-direction: column; justify-content: center; background: #f5f5f5; padding: 15px 20px; border-radius: 8px;">
      <p><strong>Summary</strong></p>
      <ul style="margin: 10px 0 0 0;">
        <li>Strong Q4 performance</li>
        <li>All regions exceeded targets</li>
      </ul>
    </div>
    <div style="position: relative; min-height: 0; min-width: 0;">
      <canvas data-chart="line">
      <!--
      {
        "data": {
          "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
          "datasets": [{
            "label": "Growth",
            "data": [100, 120, 135, 150, 180, 210],
            "borderColor": "#2196F3",
            "fill": false
          }]
        },
        "options": {
          "maintainAspectRatio": false
        }
      }
      -->
      </canvas>
    </div>
  </div>
</section>
```

**Common row fractions:**
- `1fr 3fr` - 25% content / 75% chart (minimal text)
- `1fr 2fr` - 33% content / 67% chart (short paragraph or bullet list)
- `1fr 1fr` - 50% / 50% equal split

### Quarter Slide (Quadrant)

Chart in one quadrant (bottom-right), other content in remaining three:

```html
<section style="display: flex; flex-direction: column; height: 100%;">
  <h2>Dashboard View</h2>
  <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 15px; min-height: 0; min-width: 0;">
    <div style="display: flex; align-items: center; justify-content: center; background: #e3f2fd; padding: 15px; border-radius: 8px;">
      <div style="text-align: center;">
        <p style="font-size: 2em; margin: 0; color: #1565c0;">$2.4M</p>
        <p style="margin: 0; color: #666;">Total Revenue</p>
      </div>
    </div>
    <div style="display: flex; align-items: center; justify-content: center; background: #e8f5e9; padding: 15px; border-radius: 8px;">
      <div style="text-align: center;">
        <p style="font-size: 2em; margin: 0; color: #2e7d32;">+18%</p>
        <p style="margin: 0; color: #666;">Growth Rate</p>
      </div>
    </div>
    <div style="display: flex; align-items: center; justify-content: center; background: #fff3e0; padding: 15px; border-radius: 8px;">
      <div style="text-align: center;">
        <p style="font-size: 2em; margin: 0; color: #ef6c00;">847</p>
        <p style="margin: 0; color: #666;">New Customers</p>
      </div>
    </div>
    <div style="position: relative; min-height: 0; min-width: 0;">
      <canvas data-chart="doughnut">
      <!--
      {
        "data": {
          "labels": ["Product A", "Product B", "Product C"],
          "datasets": [{
            "data": [40, 35, 25],
            "backgroundColor": ["#2196F3", "#4caf50", "#ff9800"]
          }]
        },
        "options": {
          "maintainAspectRatio": false,
          "plugins": {
            "legend": { "position": "bottom" }
          }
        }
      }
      -->
      </canvas>
    </div>
  </div>
</section>
```

## Why This Pattern Works

Chart.js by default maintains a 2:1 aspect ratio, which causes overflow in constrained slide layouts. The flexbox/grid pattern solves this by:

1. **`height: 100%` on section** - Makes the slide fill available space
2. **`flex: 1` on container** - Expands to fill remaining space after title
3. **`min-height: 0; min-width: 0`** - Allows flex/grid children to shrink below content size (critical for preventing overflow)
4. **`position: relative`** - Required by Chart.js for responsive sizing
5. **`maintainAspectRatio: false`** - Tells Chart.js to fill container instead of maintaining ratio

## Styling Charts

### Colors

Set colors in the JSON configuration:

```json
"datasets": [{
  "data": [12, 19, 8, 15],
  "backgroundColor": ["#2563eb", "#14b8a6", "#3b82f6", "#0f172a"]
}]
```

### Common color arrays for charts

```javascript
// Default palette (use these first)
["#2563eb", "#14b8a6", "#3b82f6", "#0f172a", "#93c5fd"]

// Sequential (one hue, light -> dark)
["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1e3a8a"]

// Grayscale (ink tints)
["#0f172a", "#33334d", "#666680", "#9999ad", "#ccccd6"]

// Categorical (mixed accents)
["#2563eb", "#14b8a6", "#3b82f6", "#f9a825", "#2e9e8f"]
```

## Common Options

### Hide Legend

```json
"options": {
  "maintainAspectRatio": false,
  "plugins": {
    "legend": { "display": false }
  }
}
```

### Custom Axis Labels

```json
"options": {
  "maintainAspectRatio": false,
  "scales": {
    "y": {
      "title": { "display": true, "text": "Revenue ($)" }
    },
    "x": {
      "title": { "display": true, "text": "Quarter" }
    }
  }
}
```

### Start Y-Axis at Zero

```json
"options": {
  "maintainAspectRatio": false,
  "scales": {
    "y": { "beginAtZero": true }
  }
}
```

### Legend Position

```json
"options": {
  "maintainAspectRatio": false,
  "plugins": {
    "legend": { "position": "bottom" }
  }
}
```

## CSV Data Format

You can define data using CSV format (simpler than JSON):

```html
<canvas data-chart="line">
<!--
Month, Sales, Expenses
Jan, 40, 30
Feb, 50, 35
Mar, 60, 40
Apr, 55, 38
May, 70, 45
-->
</canvas>
```

The first row becomes labels, subsequent columns become datasets.

## External CSV Files

For larger datasets, use external CSV files:

```html
<canvas data-chart="line" data-chart-src="data/sales.csv">
<!--
{
  "options": {
    "maintainAspectRatio": false,
    "plugins": { "legend": { "position": "bottom" } }
  }
}
-->
</canvas>
```

## Validation

Run the overflow check script to verify charts don't overflow:

```bash
node scripts/check-overflow.js presentation.html
```

## Tips

1. **Always use the flexbox pattern** - Never set fixed height on canvas directly
2. **Always include `maintainAspectRatio: false`** in chart options
3. **Keep charts simple** - Presentations aren't dashboards
4. **Use consistent colors** - Match your presentation's color palette
5. **Limit data points** - 4-8 points is ideal for readability
6. **Test overflow** - Run `check-overflow.js` after adding charts
