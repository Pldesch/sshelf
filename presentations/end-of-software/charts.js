/*
 * Brand-aware ECharts runtime for reveal.js.
 *
 * - Reads brand colors from CSS custom properties (--primary-color, …), so charts
 *   match the deck and re-theme live when the palette changes.
 * - Renders declarative chart specs: <div data-echart data-spec='{…}'></div>.
 * - Drives progressive disclosure off reveal fragments: any series / pie segment /
 *   annotation can declare a `step`, and animates in when that fragment is shown.
 *   (Add one empty <span class="fragment"> per step so reveal holds the slide.)
 *
 * Works standalone (Present) and inside the studio preview (which reveals all
 * fragments on select, so the chart shows complete).
 */
window.StudioCharts = (function () {
  var entries = [];

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function palette() {
    return {
      primary: cssVar('--primary-color', '#5b24b9'),
      secondary: cssVar('--secondary-color', '#fea9c6'),
      accent: cssVar('--accent-purple', '#7a3cf6'),
      ink: cssVar('--chart-ink', '#3a3a52'),
      grid: cssVar('--chart-grid', 'rgba(120,120,140,0.16)'),
      font: cssVar('--body-font', 'Inter, system-ui, sans-serif'),
    };
  }
  function pick(c, p, i) {
    if (!c) return [p.primary, p.secondary, p.accent][i % 3];
    return { primary: p.primary, secondary: p.secondary, accent: p.accent }[c] || c;
  }
  function fade(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function buildOption(spec, p, step) {
    var common = {
      textStyle: { fontFamily: p.font, color: p.ink },
      animationDuration: 850,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 650,
      animationEasingUpdate: 'cubicOut',
    };

    if (spec.type === 'donut' || spec.type === 'pie') {
      var seg = spec.data.filter(function (d) { return !d.step || d.step <= step; });
      common.tooltip = { trigger: 'item' };
      common.legend = { bottom: 4, icon: 'circle', textStyle: { color: p.ink } };
      common.series = [{
        type: 'pie',
        radius: spec.type === 'donut' ? ['48%', '74%'] : '72%',
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 6 },
        label: { color: p.ink, fontSize: 15 },
        data: seg.map(function (d, i) {
          return { value: d.value, name: d.name, itemStyle: { color: pick(d.color, p, i) } };
        }),
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDuration: 900,
      }];
      return common;
    }

    // line / bar
    var vis = spec.series.filter(function (s) { return !s.step || s.step <= step; });
    common.grid = { left: 52, right: 28, top: 30, bottom: 46 };
    common.tooltip = { trigger: 'axis' };
    common.legend = { top: 0, right: 0, icon: 'roundRect', textStyle: { color: p.ink } };
    common.xAxis = {
      type: 'category',
      data: spec.x,
      boundaryGap: spec.type === 'bar',
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
      axisLabel: { color: p.ink, fontSize: 13 },
    };
    common.yAxis = {
      type: 'value',
      max: spec.max,
      min: spec.min,
      name: spec.yName,
      nameTextStyle: { color: p.ink, align: 'left' },
      splitLine: { lineStyle: { color: p.grid } },
      axisLabel: { color: p.ink, fontSize: 13 },
    };
    common.series = vis.map(function (s, i) {
      var c = pick(s.color, p, i);
      var base = { name: s.name, type: spec.type, data: s.data, emphasis: { focus: 'series' } };
      if (spec.type === 'line') {
        base.smooth = s.smooth !== false;
        base.symbol = 'circle';
        base.symbolSize = 8;
        base.showSymbol = s.symbols !== false;
        base.lineStyle = { width: 3.5, color: c, type: s.dashed ? 'dashed' : 'solid' };
        base.itemStyle = { color: c, borderColor: '#fff', borderWidth: 2 };
        if (s.area) base.areaStyle = { color: fade(c, 0.18) };
      } else {
        base.barWidth = '46%';
        base.itemStyle = { color: c, borderRadius: [8, 8, 0, 0] };
        base.animationDelay = function (idx) { return idx * 90; };
      }
      if (spec.mark && spec.mark.step <= step && i === 0) {
        base.markLine = {
          symbol: 'none',
          lineStyle: { color: p.accent, type: 'dashed', width: 2 },
          label: { formatter: spec.mark.text, color: p.ink, fontWeight: 600, position: 'insideEndTop' },
          data: [{ xAxis: spec.mark.x }],
        };
      }
      return base;
    });
    return common;
  }

  function ensureInit(entry) {
    if (entry.chart) return;
    // SVG renderer scales crisply with reveal's CSS transform.
    entry.chart = echarts.init(entry.el, null, { renderer: 'svg' });
    entry.lastStep = -1;
    // Container size can still be settling during a slide transition — re-measure.
    setTimeout(function () { if (entry.chart) entry.chart.resize(); }, 60);
  }

  function update(entry, step) {
    ensureInit(entry);
    var notMerge = step < entry.lastStep; // stepping back: reset cleanly
    entry.chart.setOption(buildOption(entry.spec, palette(), step), notMerge);
    entry.lastStep = step;
  }

  function currentStep() {
    return window.Reveal && Reveal.getIndices ? Reveal.getIndices().f + 1 : 999;
  }
  function refreshCurrent() {
    if (!window.Reveal || !Reveal.getCurrentSlide) return;
    var sec = Reveal.getCurrentSlide();
    var step = currentStep();
    entries.forEach(function (e) { if (e.section === sec) update(e, step); });
  }

  // reveal's print-pdf mode lays out every slide at once (no "current" slide), so
  // render every chart fully revealed for the exported PDF.
  function isPrint() {
    try { if (window.Reveal && Reveal.isPrintingPDF && Reveal.isPrintingPDF()) return true; } catch (e) { /* */ }
    return /(?:\?|&)print-pdf/.test(location.search);
  }
  function refreshAll() {
    entries.forEach(function (e) { update(e, 999); });
  }

  function boot() {
    document.querySelectorAll('[data-echart]').forEach(function (el) {
      var spec;
      try { spec = JSON.parse(el.getAttribute('data-spec')); } catch (e) { return; }
      entries.push({ el: el, spec: spec, section: el.closest('section'), chart: null, lastStep: -1 });
    });
    if (window.Reveal) {
      Reveal.on('ready', function () { isPrint() ? refreshAll() : refreshCurrent(); });
      Reveal.on('slidechanged', refreshCurrent);
      Reveal.on('fragmentshown', refreshCurrent);
      Reveal.on('fragmenthidden', refreshCurrent);
      Reveal.on('slidetransitionend', function () {
        entries.forEach(function (e) { if (e.chart && e.section === Reveal.getCurrentSlide()) e.chart.resize(); });
      });
      Reveal.on('resize', function () {
        entries.forEach(function (e) { if (e.chart) e.chart.resize(); });
      });
    }
    refreshCurrent();
  }

  return { boot: boot };
})();
