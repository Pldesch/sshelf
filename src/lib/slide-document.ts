import { parentOf, rawFileUrl } from "./file-kinds"
import { annotateSlideTextTargets } from "./slide-editing"

const BLOCKED_ELEMENTS = "script, iframe, object, embed, base, form"
const URL_ATTRIBUTES = [
  "href",
  "src",
  "poster",
  "xlink:href",
  "data-background-image",
  "data-background-video",
]
const REWRITTEN_ASSET_ATTRIBUTES = new Set([
  "src",
  "poster",
  "data-background-image",
  "data-background-video",
])

const DEFAULT_SLIDE_GEOMETRY = {
  width: 960,
  height: 700,
  margin: 0,
} as const

interface SlideGeometry {
  width: number
  height: number
  margin: number
}

function slideGeometryOf(documentElement: Element): SlideGeometry {
  return {
    width: geometryAttribute(
      documentElement,
      "data-slide-width",
      DEFAULT_SLIDE_GEOMETRY.width,
      320,
      7680
    ),
    height: geometryAttribute(
      documentElement,
      "data-slide-height",
      DEFAULT_SLIDE_GEOMETRY.height,
      240,
      4320
    ),
    margin: geometryAttribute(
      documentElement,
      "data-slide-margin",
      DEFAULT_SLIDE_GEOMETRY.margin,
      0,
      0.5
    ),
  }
}

function geometryAttribute(
  element: Element,
  attribute: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = element.getAttribute(attribute)
  if (raw === null) return fallback
  const value = Number(raw)
  if (
    !raw.trim() ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${attribute} must be a number between ${minimum} and ${maximum}`
    )
  }
  return value
}

function buildHostCss({ width, height }: SlideGeometry): string {
  return `html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.reveal-viewport,
.reveal {
  --sshelf-slide-width: ${width}px;
  --sshelf-slide-height: ${height}px;
  background-color: #fff !important;
}

.reveal .backgrounds .slide-background {
  background: #fff !important;
}

html body .reveal .slides > section:not(.stack),
html body .reveal .slides > section > section,
html body .reveal .slides .pdf-page > section:not(.stack) {
  width: var(--sshelf-slide-width) !important;
  height: var(--sshelf-slide-height) !important;
  overflow: hidden;
}`
}

const PREVIEW_EDIT_CSS = `[data-sshelf-edit-key] {
  cursor: text;
}

[data-sshelf-edit-key]:hover {
  outline: 2px solid rgb(37 99 235 / 55%);
  outline-offset: 4px;
}`

interface BuildSlideSrcDocOptions {
  source: string
  path: string
  resetCss: string
  revealCss: string
  themeCss: string
  revealScript: string
  mode?: "preview" | "print"
}

function isExternalOrEmbeddedUrl(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//") ||
    value.startsWith("#") ||
    value.startsWith("/")
  )
}

function resolveRelativeAsset(deckPath: string, value: string): string {
  if (!value || isExternalOrEmbeddedUrl(value)) return value
  const stack = parentOf(deckPath).split("/").filter(Boolean)
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") stack.pop()
    else stack.push(segment)
  }
  return rawFileUrl(stack.join("/"))
}

function isUnsafeUrl(value: string): boolean {
  const compact = [...value]
    .filter((character) => character.charCodeAt(0) > 32)
    .join("")
    .toLowerCase()
  return compact.startsWith("javascript:") || compact.startsWith("vbscript:")
}

function sanitizeSlides(slides: Element, path: string): void {
  slides
    .querySelectorAll(BLOCKED_ELEMENTS)
    .forEach((element) => element.remove())

  for (const element of [slides, ...slides.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name)
        continue
      }
      if (!URL_ATTRIBUTES.includes(name)) continue
      if (isUnsafeUrl(attribute.value)) {
        element.removeAttribute(attribute.name)
      } else if (REWRITTEN_ASSET_ATTRIBUTES.has(name)) {
        element.setAttribute(
          attribute.name,
          resolveRelativeAsset(path, attribute.value)
        )
      }
    }
  }
}

function escapeStyle(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style")
}

function escapeScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script")
}

function buildPrintRuntimeScript(
  revealScript: string,
  geometry: SlideGeometry
): string {
  return `${escapeScript(revealScript)}\n
function sshelfWaitForPrintAssets() {
  var images = Array.from(document.images).map(function (image) {
    if (image.complete) return Promise.resolve()
    return new Promise(function (resolve) {
      image.addEventListener("load", resolve, { once: true })
      image.addEventListener("error", resolve, { once: true })
    })
  })
  var fonts = document.fonts && document.fonts.ready
    ? document.fonts.ready.catch(function () {})
    : Promise.resolve()
  return Promise.all([fonts].concat(images))
}

function sshelfPreserveSlideLayout() {
  var slides = Array.from(document.querySelectorAll(
    ".slides > section, .slides > section > section"
  )).filter(function (slide) {
    return !Array.from(slide.children).some(function (child) {
      return child.tagName === "SECTION"
    })
  })

  slides.forEach(function (slide) {
    var computed = window.getComputedStyle(slide)
    ;["padding-top", "padding-right", "padding-bottom", "padding-left"].forEach(function (property) {
      slide.style.setProperty(property, computed.getPropertyValue(property), "important")
    })

    var display = computed.getPropertyValue("display")
    if (display !== "none") {
      slide.style.setProperty("display", display, "important")
    }
  })
}

function sshelfReportPdfError(error) {
  var message = error && error.message ? error.message : String(error)
  window.parent.postMessage({
    channel: "sshelf:slides:v1",
    type: "pdf-error",
    message: message
  }, "*")
}

window.addEventListener("error", function (event) {
  sshelfReportPdfError(event.error || event.message)
})

window.addEventListener("unhandledrejection", function (event) {
  sshelfReportPdfError(event.reason)
})

Reveal.on("pdf-ready", function () {
  window.parent.postMessage({ channel: "sshelf:slides:v1", type: "pdf-ready" }, "*")
})

window.addEventListener("message", function (event) {
  if (
    event.source !== window.parent ||
    !event.data ||
    event.data.channel !== "sshelf:slides:v1" ||
    event.data.type !== "print-pdf"
  ) return
  window.parent.postMessage({ channel: "sshelf:slides:v1", type: "pdf-printing" }, "*")
  window.print()
  window.parent.postMessage({ channel: "sshelf:slides:v1", type: "pdf-finished" }, "*")
})

sshelfWaitForPrintAssets().then(function () {
  sshelfPreserveSlideLayout()
  return Reveal.initialize({
    embedded: false,
    view: "print",
    width: ${geometry.width},
    height: ${geometry.height},
    margin: ${geometry.margin},
    hash: false,
    controls: false,
    progress: false,
    center: true,
    transition: "none",
    pdfSeparateFragments: false
  })
}).catch(sshelfReportPdfError)`
}

/**
 * Turn the small, source-controlled .slides.html dialect into a complete
 * Reveal document. The result is designed for an opaque-origin iframe.
 */
export function buildSlideSrcDoc({
  source,
  path,
  resetCss,
  revealCss,
  themeCss,
  revealScript,
  mode = "preview",
}: BuildSlideSrcDocOptions): string {
  const parsed = new DOMParser().parseFromString(source, "text/html")
  const geometry = slideGeometryOf(parsed.documentElement)
  const slides = parsed.querySelector(".reveal > .slides")
  if (!slides) {
    throw new Error('Slide decks need a ".reveal > .slides" container')
  }

  if (mode === "preview") annotateSlideTextTargets(slides)
  sanitizeSlides(slides, path)
  const authoredCss = [...parsed.querySelectorAll("style")]
    .map((style) => style.textContent)
    .join("\n")
  const runtimeCss = `${buildHostCss(geometry)}\n${
    mode === "preview" ? PREVIEW_EDIT_CSS : ""
  }\n${resetCss}\n${revealCss}\n${themeCss}`
  const runtimeScript =
    mode === "print"
      ? buildPrintRuntimeScript(revealScript, geometry)
      : `${escapeScript(revealScript)}\n
Reveal.initialize({
  embedded: true,
  width: ${geometry.width},
  height: ${geometry.height},
  margin: ${geometry.margin},
  hash: false,
  keyboardCondition: "focused",
  controls: true,
  progress: true,
  center: true,
  transition: "slide"
}).then(function () {
  window.parent.postMessage({ channel: "sshelf:slides:v1", type: "ready" }, "*")
})

var sshelfEditingEnabled = true
var sshelfActiveTarget = null

function sshelfScaledLength(value, scale) {
  var number = Number.parseFloat(value)
  return Number.isFinite(number) ? number * scale + "px" : value
}

function sshelfTargetByKey(key) {
  return Array.from(document.querySelectorAll("[data-sshelf-edit-key]")).find(function (element) {
    return element.getAttribute("data-sshelf-edit-key") === key
  })
}

document.addEventListener("dblclick", function (event) {
  if (!sshelfEditingEnabled || !(event.target instanceof Element)) return
  var target = event.target.closest("[data-sshelf-edit-key]")
  if (!target) return
  event.preventDefault()
  event.stopPropagation()

  if (sshelfActiveTarget && sshelfActiveTarget !== target) {
    sshelfActiveTarget.style.visibility = ""
  }
  sshelfActiveTarget = target

  var rect = target.getBoundingClientRect()
  var computed = window.getComputedStyle(target)
  var scale = Reveal.getScale() || 1
  target.style.visibility = "hidden"

  window.parent.postMessage({
    channel: "sshelf:slides:v1",
    type: "edit-request",
    key: target.getAttribute("data-sshelf-edit-key"),
    html: target.innerHTML,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    style: {
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontFeatureSettings: computed.fontFeatureSettings,
      fontKerning: computed.fontKerning,
      fontOpticalSizing: computed.fontOpticalSizing,
      fontSize: sshelfScaledLength(computed.fontSize, scale),
      fontStyle: computed.fontStyle,
      fontStretch: computed.fontStretch,
      fontVariant: computed.fontVariant,
      fontVariationSettings: computed.fontVariationSettings,
      fontWeight: computed.fontWeight,
      letterSpacing: sshelfScaledLength(computed.letterSpacing, scale),
      lineHeight: sshelfScaledLength(computed.lineHeight, scale),
      paddingBottom: sshelfScaledLength(computed.paddingBottom, scale),
      paddingLeft: sshelfScaledLength(computed.paddingLeft, scale),
      paddingRight: sshelfScaledLength(computed.paddingRight, scale),
      paddingTop: sshelfScaledLength(computed.paddingTop, scale),
      textAlign: computed.textAlign,
      textDecoration: computed.textDecoration,
      textRendering: computed.textRendering,
      textTransform: computed.textTransform,
      whiteSpace: computed.whiteSpace,
      wordSpacing: sshelfScaledLength(computed.wordSpacing, scale)
    }
  }, "*")
})

document.addEventListener("pointerdown", function (event) {
  if (
    sshelfActiveTarget &&
    event.target instanceof Element &&
    !sshelfActiveTarget.contains(event.target)
  ) {
    window.parent.postMessage({
      channel: "sshelf:slides:v1",
      type: "edit-dismiss"
    }, "*")
  }
})

window.addEventListener("message", function (event) {
  if (event.source !== window.parent || !event.data || event.data.channel !== "sshelf:slides:v1") return
  if (event.data.type === "set-editing-enabled") {
    sshelfEditingEnabled = event.data.enabled === true
    return
  }
  if (event.data.type !== "edit-finish" || typeof event.data.key !== "string") return
  var target = sshelfTargetByKey(event.data.key)
  if (!target) return
  target.innerHTML = event.data.html
  target.style.visibility = ""
  sshelfActiveTarget = null
  Reveal.layout()
})`

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: http: https:; media-src data: blob: http: https:; font-src data: http: https:; style-src 'unsafe-inline'; script-src 'nonce-sshelf-slides'">
    <style>${escapeStyle(runtimeCss)}</style>
    <style>${escapeStyle(authoredCss)}</style>
  </head>
  <body>
    <div class="reveal">
      <div class="slides">${slides.innerHTML}</div>
    </div>
    <script nonce="sshelf-slides">${runtimeScript}</script>
  </body>
</html>`
}
