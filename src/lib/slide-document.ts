import { parentOf, rawFileUrl } from "./file-kinds"

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

const HOST_CSS = `html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

.reveal-viewport,
.reveal {
  background-color: #fff !important;
}

.reveal .backgrounds .slide-background {
  background: #fff !important;
}

.reveal .slides > section,
.reveal .slides > section > section {
  overflow: hidden;
}`

interface BuildSlideSrcDocOptions {
  source: string
  path: string
  resetCss: string
  revealCss: string
  themeCss: string
  revealScript: string
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
}: BuildSlideSrcDocOptions): string {
  const parsed = new DOMParser().parseFromString(source, "text/html")
  const slides = parsed.querySelector(".reveal > .slides")
  if (!slides) {
    throw new Error('Slide decks need a ".reveal > .slides" container')
  }

  sanitizeSlides(slides, path)
  const authoredCss = [...parsed.querySelectorAll("style")]
    .map((style) => style.textContent)
    .join("\n")
  const runtimeCss = `${HOST_CSS}\n${resetCss}\n${revealCss}\n${themeCss}`
  const runtimeScript = `${escapeScript(revealScript)}\n
Reveal.initialize({
  embedded: true,
  hash: false,
  controls: true,
  progress: true,
  center: true,
  transition: "slide"
}).then(function () {
  window.parent.postMessage({ channel: "sshelf:slides:v1", type: "ready" }, "*")
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
