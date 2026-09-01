import { parse } from "parse5"
import type { DefaultTreeAdapterTypes } from "parse5"

const EDIT_KEY_ATTRIBUTE = "data-sshelf-edit-key"
const BLOCK_DESCENDANTS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
].join(",")
const NON_EDITABLE_ELEMENTS = new Set([
  "audio",
  "canvas",
  "code",
  "iframe",
  "math",
  "pre",
  "script",
  "style",
  "svg",
  "video",
])
const ALLOWED_INLINE_ELEMENTS = new Set([
  "a",
  "b",
  "br",
  "code",
  "del",
  "em",
  "i",
  "mark",
  "s",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "u",
])

type ParseNode = DefaultTreeAdapterTypes.Node
type ParseElement = DefaultTreeAdapterTypes.Element

export interface SlideTextEdit {
  key: string
  html: string
}

export interface AppliedSlideTextEdit {
  source: string
  html: string
}

function isEditableTextElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase()
  if (
    NON_EDITABLE_ELEMENTS.has(tag) ||
    element.matches("aside.notes, [data-sshelf-no-edit]") ||
    !element.textContent.trim()
  ) {
    return false
  }
  return !element.querySelector(BLOCK_DESCENDANTS)
}

/**
 * Mark text regions in the disposable preview DOM. Keys are element-child
 * paths from `.slides`, so they can be resolved against the authored source.
 */
export function annotateSlideTextTargets(slides: Element): number {
  let count = 0

  function visit(parent: Element, parentPath: Array<number>): void {
    const children = [...parent.children]
    children.forEach((child, index) => {
      const path = [...parentPath, index]
      const tag = child.tagName.toLowerCase()
      if (
        NON_EDITABLE_ELEMENTS.has(tag) ||
        child.matches("aside.notes, [data-sshelf-no-edit]")
      ) {
        return
      }
      if (isEditableTextElement(child)) {
        child.setAttribute(EDIT_KEY_ATTRIBUTE, path.join("."))
        count += 1
        return
      }
      visit(child, path)
    })
  }

  visit(slides, [])
  return count
}

function isParseElement(node: ParseNode): node is ParseElement {
  return "tagName" in node
}

function elementChildren(node: { childNodes: Array<ParseNode> }) {
  return node.childNodes.filter(isParseElement)
}

function attributeValue(element: ParseElement, name: string): string | null {
  return (
    element.attrs.find((attribute) => attribute.name === name)?.value ?? null
  )
}

function hasClass(element: ParseElement, className: string): boolean {
  return (attributeValue(element, "class") ?? "")
    .split(/\s+/)
    .includes(className)
}

function findSlidesElement(node: ParseNode): ParseElement | null {
  if (isParseElement(node) && hasClass(node, "reveal")) {
    const slides = elementChildren(node).find((child) =>
      hasClass(child, "slides")
    )
    if (slides) return slides
  }
  if (!("childNodes" in node)) return null
  for (const child of node.childNodes) {
    const slides = findSlidesElement(child)
    if (slides) return slides
  }
  return null
}

function sanitizeEditedInlineHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html"
  )
  parsed
    .querySelectorAll("script, style, iframe, object, embed, form, svg, math")
    .forEach((element) => element.remove())

  for (const element of [...parsed.body.querySelectorAll("*")].reverse()) {
    const tag = element.tagName.toLowerCase()
    if (!ALLOWED_INLINE_ELEMENTS.has(tag)) {
      element.replaceWith(...element.childNodes)
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const keepClass = name === "class"
      const keepSafeStyle =
        name === "style" &&
        !/(?:url\s*\(|expression\s*\(|@import|javascript\s*:)/i.test(
          attribute.value
        )
      const keepLinkAttribute =
        tag === "a" && ["href", "target", "rel"].includes(name)
      if (!keepClass && !keepSafeStyle && !keepLinkAttribute) {
        element.removeAttribute(attribute.name)
      }
    }
    if (tag === "a") {
      const href = element.getAttribute("href") ?? ""
      const compactHref = [...href]
        .filter((character) => character.charCodeAt(0) > 32)
        .join("")
        .toLowerCase()
      if (compactHref.startsWith("javascript:")) {
        element.removeAttribute("href")
      }
    }
  }

  return parsed.body.innerHTML
}

/** Patch one runtime-selected text region without serializing the full file. */
export function applySlideTextEdit(
  source: string,
  edit: SlideTextEdit
): AppliedSlideTextEdit {
  if (!/^\d+(?:\.\d+)*$/.test(edit.key)) {
    throw new Error("The editable text target is invalid")
  }

  const parsed = parse(source, { sourceCodeLocationInfo: true })
  const slides = findSlidesElement(parsed)
  let target: ParseElement | undefined = slides ?? undefined
  for (const segment of edit.key.split(".")) {
    target = target ? elementChildren(target)[Number(segment)] : undefined
  }

  const location = target?.sourceCodeLocation
  const tag = target?.tagName.toLowerCase()
  if (
    !target ||
    !location?.startTag ||
    !location.endTag ||
    !tag ||
    NON_EDITABLE_ELEMENTS.has(tag)
  ) {
    throw new Error("The editable text target was not found")
  }

  const html = sanitizeEditedInlineHtml(edit.html)
  return {
    html,
    source: `${source.slice(0, location.startTag.endOffset)}${html}${source.slice(location.endTag.startOffset)}`,
  }
}
