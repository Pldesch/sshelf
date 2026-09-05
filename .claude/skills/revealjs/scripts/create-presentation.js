#!/usr/bin/env node

/**
 * Creates a reveal.js presentation scaffold with the specified options.
 * Usage: node create-presentation.js [options]
 */

const fs = require('fs');
const path = require('path');

// Path to the base styles file (relative to this script)
const BASE_STYLES_PATH = path.join(__dirname, '..', 'references', 'base-styles.css');

function parseArgs(args) {
  const options = {
    slides: null,
    structure: null,
    output: 'presentation.html',
    title: 'Presentation',
    stylesFile: 'styles.css',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--slides' || arg === '-s') {
      options.slides = parseInt(args[++i], 10);
    } else if (arg === '--structure') {
      options.structure = args[++i].split(',').map(n => n === 'd' ? 'd' : parseInt(n, 10));
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--title') {
      options.title = args[++i];
    } else if (arg === '--styles') {
      options.stylesFile = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
create-presentation.js - Generate a reveal.js presentation scaffold

Usage: node create-presentation.js [options]

Options:
  --slides, -s <num>    Number of horizontal slides (simple mode)
  --structure <list>    Mixed layout: comma-separated values (e.g., "1,1,d,3,1,d,1")
                        - Number 1 = single horizontal slide
                        - Number >1 = vertical stack of that many slides
                        - 'd' = section divider slide
                        Cannot be used with --slides
  --output, -o <file>   Output HTML filename (default: presentation.html)
  --title <text>        Presentation title (default: Presentation)
  --styles <file>       Custom CSS filename (default: styles.css)
  --help, -h            Show this help message

Examples:
  node create-presentation.js --slides 10 -o my-deck.html
  node create-presentation.js --structure 1,1,d,3,1,d,1 -o my-deck.html
  node create-presentation.js --structure 1,1,1,d,3,d,1,1 --title "Q4 Review"
`);
}

/** Generates slides from a structure array (e.g., [1, 1, 'd', 5, 1, 2]) */
function generateSlides(structure) {
  let slides = '';
  let hIndex = 1; // Horizontal index (1-based for display)
  let dividerCount = 1;

  for (let colIndex = 0; colIndex < structure.length; colIndex++) {
    const item = structure[colIndex];

    if (item === 'd') {
      // Section divider
      slides += `
      <section id="divider-${dividerCount}" class="section-divider" data-state="is-section-divider">
        <h1>Section ${dividerCount} Title</h1>
      </section>
`;
      dividerCount++;
      hIndex++;
    } else if (item === 1) {
      // Single horizontal slide
      if (hIndex === 1) {
        slides += `
      <section id="title" class="section-divider" data-state="is-section-divider">
        <h1>Presentation Title</h1>
      </section>
`;
      } else {
        slides += `
      <section id="slide-${hIndex}">
        <h2>Slide ${hIndex} Title Here</h2>
      </section>
`;
      }
      hIndex++;
    } else {
      // Vertical stack
      slides += `
      <section>
`;
      for (let vIndex = 1; vIndex <= item; vIndex++) {
        slides += `        <section id="slide-${hIndex}-${vIndex}">
          <h2>Slide ${hIndex}.${vIndex} Title Here</h2>
        </section>
`;
      }
      slides += `      </section>
`;
      hIndex++;
    }
  }

  return slides;
}

function generateHTML(options) {
  const slidesContent = generateSlides(options.structure);

  // Auto-link snippet. Defined with String.raw so the regex backslashes survive being
  // embedded in the HTML template literal below (a plain literal would eat \b, \s, \/ …).
  const AUTOLINK = String.raw`
    // --- Auto-link: make plain URLs / emails in slide text clickable (open in a new tab) ---
    (function () {
      var st = document.createElement('style');
      st.textContent =
        '.reveal a.autolink{color:inherit;text-decoration:none}' +
        '.reveal a.autolink:hover{text-decoration:underline}';
      document.head.appendChild(st);
      var RE = /\b((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>()]*)?|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24})/gi;
      var SKIP = { js:1, ts:1, tsx:1, jsx:1, css:1, scss:1, html:1, htm:1, json:1, xml:1, md:1, txt:1, png:1, jpg:1, jpeg:1, gif:1, svg:1, webp:1, mp4:1, py:1, go:1, rs:1, sh:1, yml:1, yaml:1, pdf:1, ppt:1, pptx:1, doc:1, docx:1, xls:1, xlsx:1, csv:1, tsv:1, key:1, pages:1, rtf:1, odt:1, ods:1, odp:1, exe:1, msi:1, dmg:1, pkg:1, iso:1, woff:1, woff2:1, ttf:1, otf:1, eot:1, psd:1, wav:1, flac:1, aac:1, avi:1, mkv:1, mpg:1, mpeg:1, heic:1, tiff:1, bmp:1, ico:1 };
      var SKIP_TAGS = { A:1, CODE:1, PRE:1, SCRIPT:1, STYLE:1, BUTTON:1, TEXTAREA:1, KBD:1, SAMP:1, SVG:1 };
      function hrefFor(t) {
        if (t.indexOf('@') !== -1 && t.indexOf('/') === -1) return 'mailto:' + t;
        return /^https?:\/\//i.test(t) ? t : 'https://' + t;
      }
      function skip(t) {
        if (t.indexOf('@') !== -1 || t.indexOf('/') !== -1 || /^https?:\/\//i.test(t)) return false;
        return SKIP[t.slice(t.lastIndexOf('.') + 1).toLowerCase()] === 1;
      }
      function linkify(node) {
        var text = node.nodeValue, m, last = 0, frag = null;
        RE.lastIndex = 0;
        while ((m = RE.exec(text)) !== null) {
          var raw = m[0], token = raw, trail = '';
          var tm = token.match(/[.,;:!?]+$/);
          if (tm) { trail = tm[0]; token = token.slice(0, token.length - trail.length); }
          if (!token || skip(token)) continue;
          frag = frag || document.createDocumentFragment();
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var a = document.createElement('a');
          a.className = 'autolink'; a.href = hrefFor(token);
          a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = token;
          frag.appendChild(a);
          if (trail) frag.appendChild(document.createTextNode(trail));
          last = m.index + raw.length;
        }
        if (frag) {
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          node.parentNode.replaceChild(frag, node);
        }
      }
      function run() {
        var root = document.querySelector('.reveal .slides');
        if (!root) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode: function (n) {
            if (!n.nodeValue || !/[a-z]/i.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
            for (var p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) {
              if (p.nodeType === 1) {
                var tn = p.tagName.toUpperCase();
                if (SKIP_TAGS[tn] || (p.classList && p.classList.contains('no-autolink'))) return NodeFilter.FILTER_REJECT;
              }
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var nodes = [], cur;
        while ((cur = walker.nextNode())) nodes.push(cur);
        nodes.forEach(linkify);
      }
      if (window.Reveal && Reveal.on) Reveal.on('ready', run);
      setTimeout(run, 800);
    })();`;

  // Mobile orientation guard. On a touch phone, portrait shows a "rotate to landscape"
  // prompt and landscape behaves like desktop (arrow/tap navigation, page scroll locked so
  // a stray up/down swipe can't break the deck). Gated on touch screens via
  // `(pointer: coarse) and (hover: none)`, so desktop — including a portrait monitor or
  // "request desktop site" — is never affected.
  const ROTATE = String.raw`
    // --- Mobile: portrait shows a "rotate to landscape" prompt; in landscape the deck
    //     behaves like desktop — navigate with the arrows / screen taps, with page scroll
    //     locked so a stray up/down swipe can't break the layout. Desktop (including a
    //     portrait monitor) is never affected: the rules are gated on touch screens only. ---
    (function () {
      var TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse) and (hover: none)').matches);

      var css =
        '.deck-rotate{display:none}' +
        '@media (pointer:coarse) and (hover:none){' +
          'html{overflow:hidden!important;overscroll-behavior:none;height:100%}' +
          'body{overflow:hidden!important;overscroll-behavior:none;position:fixed;top:0;left:0;width:100%;height:100%;margin:0}' +
        '}' +
        '@media (orientation:portrait) and (pointer:coarse) and (hover:none){' +
          '.reveal{visibility:hidden!important}' +
          '.deck-rotate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:8vw;background:#0f172a;color:#fff;text-align:center;font-family:"IBM Plex Sans",Helvetica,sans-serif}' +
          '.deck-rotate-inner{display:flex;flex-direction:column;align-items:center;max-width:34ch}' +
          '.deck-rotate-icon{font-size:64pt;color:#14b8a6;line-height:1;margin-bottom:20px}' +
          '.deck-rotate-icon i{display:inline-block;animation:deckRotateHint 2.4s ease-in-out infinite}' +
          '.deck-rotate-title{font-size:22pt;font-weight:700;margin:0 0 10px;color:#fff}' +
          '.deck-rotate-sub{font-size:13pt;font-weight:400;line-height:1.5;margin:0;color:rgba(255,255,255,.82)}' +
        '}' +
        '@keyframes deckRotateHint{0%,18%{transform:rotate(0)}46%,72%{transform:rotate(90deg)}96%,100%{transform:rotate(0)}}' +
        '@media (prefers-reduced-motion:reduce){.deck-rotate-icon i{animation:none}}';
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

      // The prompt lives outside .reveal so it stays visible while the deck is hidden.
      var ov = document.createElement('div');
      ov.className = 'deck-rotate'; ov.setAttribute('role', 'alert');
      ov.innerHTML =
        '<div class="deck-rotate-inner">' +
          '<div class="deck-rotate-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>' +
          '<p class="deck-rotate-title">Bitte ins Querformat drehen</p>' +
          '<p class="deck-rotate-sub">Diese Präsentation ist für die Breitansicht gemacht — drehe dein Gerät ins Querformat.</p>' +
        '</div>';
      document.body.appendChild(ov);

      // On phones, navigate like a desktop: arrows / on-screen taps only, no swipe-scroll.
      if (TOUCH && window.Reveal && Reveal.configure) {
        var deskNav = function () { try { Reveal.configure({ touch: false }); } catch (e) {} };
        if (Reveal.on) Reveal.on('ready', deskNav);
        deskNav();

        // The left/right edge zones navigate on tap. A touch-synthesised "click" is
        // unreliable on mobile (works on desktop mouse), so drive them from touchend
        // directly and preventDefault to swallow the ghost click — no double-step on
        // devices where the click does fire.
        var bindTap = function (sel, go) {
          var z = document.querySelector(sel);
          if (!z) return;
          z.addEventListener('touchend', function (e) {
            if (z.classList.contains('disabled')) return;
            e.preventDefault();
            go();
          }, { passive: false });
        };
        bindTap('.nav-zone.left', function () { Reveal.prev(); });
        bindTap('.nav-zone.right', function () { Reveal.next(); });
      }

      // If the deck first loads in PORTRAIT on a phone, reveal.js + the chart / fragment
      // animation scripts initialise hidden behind the rotate prompt and come up broken
      // (charts don't render, builds don't advance) — and rotating doesn't recover them.
      // A landscape load initialises cleanly, so reload once when the device turns to
      // landscape. Can't loop: the reloaded page is already landscape. Slide kept via hash.
      if (TOUCH && window.matchMedia('(orientation: portrait)').matches) {
        var reloadOnLandscape = function () {
          if (window.matchMedia('(orientation: landscape)').matches) location.reload();
        };
        var mqo = window.matchMedia('(orientation: landscape)');
        mqo.addEventListener ? mqo.addEventListener('change', reloadOnLandscape)
                             : mqo.addListener(reloadOnLandscape);
        window.addEventListener('orientationchange', function () { setTimeout(reloadOnLandscape, 150); });
      }
    })();`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>

  <!-- Reveal.js core -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reset.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">

  <!-- Font Awesome for icons -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">

  <!-- Custom styles -->
  <link rel="stylesheet" href="${options.stylesFile}">

  <!-- Chart.js for data visualization -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="reveal">
    <a class="estradeck-badge" href="https://github.com/Syndicats/estradeck" target="_blank" rel="noopener noreferrer" aria-label="Built with Estradeck — view on GitHub"><span class="eb-logo" aria-hidden="true">◆</span><span class="eb-text">Built with</span><span class="eb-mark"><span class="bm-w">Estra</span><span class="bm-g">de</span><span class="bm-p">ck</span></span></a>
    <div class="slides">
${slidesContent}
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js-plugins@latest/chart/plugin.js"></script>
  <script>
    Reveal.initialize({
      width: 1280,
      height: 720,
      margin: 0,
      controls: true,
      progress: true,
      slideNumber: false,
      hash: true,
      transition: 'slide',
      center: false,
      overview: false,
      scrollActivationWidth: null,  // never auto-switch to reveal's scroll view (stacked slides)
      mouseWheel: false,            // the mouse wheel never navigates or scrolls slides
      plugins: [ RevealChart ],
      chart: {
        defaults: Object.assign({
          color: 'rgba(0, 0, 25, 0.6)',
          borderColor: 'rgba(0, 0, 25, 0.1)',
          font: { family: "'IBM Plex Sans', Helvetica, sans-serif", size: 13, weight: 400, lineHeight: 1.4 },
          animation: { duration: 1400, easing: 'easeOutQuart' },
          devicePixelRatio: 2
        }, window.location.search.includes('export') ? { animation: false } : {})
      }
    });

    // --- Mouse navigation: hover the left/right edge, click to step back/forward ---
    (function () {
      // Works with mouse (hover shows the arrow, click navigates) and touch (tap left/right).
      var css =
        '.reveal .nav-zone{position:fixed;top:0;bottom:0;width:13%;z-index:34;display:flex;align-items:center;cursor:pointer;opacity:0;transition:opacity .18s ease;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}' +
        '.reveal .nav-zone.left{left:0;justify-content:flex-start;padding-left:22px}' +
        '.reveal .nav-zone.right{right:0;justify-content:flex-end;padding-right:22px}' +
        '.reveal .nav-zone:hover,.reveal .nav-zone:active{opacity:1}' +
        '@media (pointer:coarse){.reveal .nav-zone{width:18%;opacity:1}}' +
        '.reveal .nav-zone.disabled{pointer-events:none;opacity:0 !important}' +
        '.reveal .nav-zone .nav-arrow{width:58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,30,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.3);box-shadow:0 8px 28px rgba(0,0,0,.3)}' +
        '.reveal .nav-zone .nav-arrow svg{width:26px;height:26px;display:block}';
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      function make(side, glyph, fn) {
        var z = document.createElement('div'); z.className = 'nav-zone ' + side;
        var a = document.createElement('div'); a.className = 'nav-arrow'; a.innerHTML = glyph;
        z.appendChild(a); z.addEventListener('click', fn); return z;
      }
      var reveal = document.querySelector('.reveal');
      var CHEV_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6 L9 12 L15 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var CHEV_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6 L15 12 L9 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var left = make('left', CHEV_L, function () { Reveal.prev(); });
      var right = make('right', CHEV_R, function () { Reveal.next(); });
      reveal.appendChild(left); reveal.appendChild(right);
      function update() {
        try {
          var f = Reveal.availableFragments ? Reveal.availableFragments() : { prev: false, next: false };
          left.classList.toggle('disabled', Reveal.isFirstSlide() && !f.prev);
          right.classList.toggle('disabled', Reveal.isLastSlide() && !f.next);
        } catch (e) {}
      }
      ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden', 'resize'].forEach(function (ev) {
        Reveal.on(ev, update);
      });
      // Starting in portrait shows a "rotate" prompt while Reveal initialises hidden, which
      // leaves its slide model stale (every edge looks first+last, so both arrows stay
      // .disabled → invisible). On orientation change, re-sync so the arrows match the deck.
      var resync = function () { try { Reveal.sync(); Reveal.layout(); } catch (e) {} update(); };
      window.addEventListener('orientationchange', function () { setTimeout(resync, 300); });
      try {
        var mqL = window.matchMedia('(orientation: landscape)');
        mqL.addEventListener ? mqL.addEventListener('change', resync) : mqL.addListener(resync);
      } catch (e) {}
      update();
    })();

    // --- Share: copy the deck's URL (without the per-slide deep link) to the clipboard ---
    (function () {
      if (navigator.webdriver || location.search.indexOf('ve=1') !== -1) return; // not in exports / studio preview
      var css =
        '.reveal .deck-share{position:fixed;top:18px;right:18px;z-index:36;width:42px;height:42px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);border-radius:999px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:.5;transition:background .15s ease,opacity .15s ease,transform .15s ease,border-color .15s ease}' +
        '.reveal .deck-share:hover{background:rgba(255,255,255,.3);opacity:1;transform:translateY(-1px)}' +
        '.reveal .deck-share:active{transform:translateY(0)}' +
        '.reveal .deck-share.copied{background:#fff;color:#0f172a;border-color:#fff;opacity:1}' +
        '.reveal .deck-share svg{width:18px;height:18px;display:block;fill:currentColor}';
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      var SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';
      var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'deck-share';
      btn.setAttribute('aria-label', 'Link kopieren'); btn.setAttribute('title', 'Link kopieren');
      btn.innerHTML = SHARE;
      document.querySelector('.reveal').appendChild(btn);
      function deckUrl() {
        var p = location.pathname.replace('index.html', '').replace('presentation.html', '');
        return location.origin + p;
      }
      async function copy(text) {
        try { await navigator.clipboard.writeText(text); return true; }
        catch (e) {
          var ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.focus(); ta.select();
          var ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
          document.body.removeChild(ta); return ok;
        }
      }
      var resetT;
      btn.addEventListener('click', async function () {
        if (!(await copy(deckUrl()))) return;
        btn.classList.add('copied'); btn.innerHTML = CHECK; btn.setAttribute('title', 'Link kopiert');
        clearTimeout(resetT);
        resetT = setTimeout(function () {
          btn.classList.remove('copied'); btn.innerHTML = SHARE; btn.setAttribute('title', 'Link kopieren');
        }, 1600);
      });
    })();
${AUTOLINK}
${ROTATE}
  </script>
</body>
</html>
`;
}

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Validate mutually exclusive options
  if (options.slides !== null && options.structure !== null) {
    console.error('Error: Cannot use both --slides and --structure. Choose one.');
    process.exit(1);
  }

  // Default to 5 horizontal slides if neither specified
  if (options.slides === null && options.structure === null) {
    options.structure = [1, 1, 1, 1, 1];
  } else if (options.slides !== null) {
    // Convert --slides N to structure of N ones
    if (options.slides < 1 || isNaN(options.slides)) {
      console.error('Error: Slide count must be at least 1.');
      process.exit(1);
    }
    options.structure = Array(options.slides).fill(1);
  } else {
    // Validate structure
    if (options.structure.some(n => n !== 'd' && (n < 1 || isNaN(n)))) {
      console.error('Error: Structure values must be positive integers or "d" for dividers.');
      process.exit(1);
    }
  }

  const totalSlides = options.structure.reduce((a, b) => a + (b === 'd' ? 1 : b), 0);

  // Determine output directory from the output path
  const outputDir = path.dirname(options.output);

  // Ensure output directory exists
  if (outputDir && outputDir !== '.') {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate and write HTML
  const html = generateHTML(options);
  fs.writeFileSync(options.output, html);
  console.log(`Created ${options.output}`);

  // Copy example-styles.css to output directory as styles.css (if it doesn't exist)
  const stylesOutputPath = outputDir && outputDir !== '.'
    ? path.join(outputDir, options.stylesFile)
    : options.stylesFile;

  if (!fs.existsSync(stylesOutputPath)) {
    if (fs.existsSync(BASE_STYLES_PATH)) {
      fs.copyFileSync(BASE_STYLES_PATH, stylesOutputPath);
      console.log(`Copied base-styles.css to ${stylesOutputPath}`);
    } else {
      console.warn(`Warning: Could not find ${BASE_STYLES_PATH}`);
      console.warn(`Please manually copy the base styles to ${stylesOutputPath}`);
    }
  } else {
    console.log(`${stylesOutputPath} already exists, skipping`);
  }

  console.log(`\nPresentation created with ${totalSlides} slides (structure: ${options.structure.join(',')}).`);
  console.log(`Customize colors in ${stylesOutputPath}, then open ${options.output} in a browser to view.`);
}

main();
