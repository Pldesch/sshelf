import { useHotkey } from "@tanstack/react-hotkeys"
import type {
  HotkeyCallback,
  RegisterableHotkey,
  UseHotkeyOptions,
} from "@tanstack/react-hotkeys"

const EDITABLE_TARGET_SELECTOR = [
  "input:not([type='button']):not([type='submit']):not([type='reset'])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
].join(", ")

const APP_SHORTCUTS_DISABLED_SELECTOR = "[data-app-shortcuts='off']"

interface AppHotkeyPolicy {
  allowInEditable?: boolean
}

export type AppHotkeyOptions = Omit<
  UseHotkeyOptions,
  "ignoreInputs" | "preventDefault" | "stopPropagation"
> &
  AppHotkeyPolicy

function eventPath(event: KeyboardEvent): Array<EventTarget> {
  const path = event.composedPath()
  return path.length > 0 ? path : event.target ? [event.target] : []
}

export function shouldIgnoreAppHotkey(
  event: KeyboardEvent,
  { allowInEditable = false }: AppHotkeyPolicy = {}
): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return true

  const elements = eventPath(event).filter(
    (target): target is HTMLElement => target instanceof HTMLElement
  )
  if (
    elements.some((element) => element.matches(APP_SHORTCUTS_DISABLED_SELECTOR))
  ) {
    return true
  }

  return (
    !allowInEditable &&
    elements.some(
      (element) =>
        element.isContentEditable || element.matches(EDITABLE_TARGET_SELECTOR)
    )
  )
}

/**
 * Registers an application shortcut with one ownership policy. Local editors
 * win when they already handled the event, editable controls are ignored by
 * default, and complex views can opt out via data-app-shortcuts="off".
 */
export function useAppHotkey(
  hotkey: RegisterableHotkey,
  callback: HotkeyCallback,
  options: AppHotkeyOptions = {}
): void {
  const { allowInEditable = false, ...hotkeyOptions } = options

  useHotkey(
    hotkey,
    (event, context) => {
      if (shouldIgnoreAppHotkey(event, { allowInEditable })) return

      event.preventDefault()
      event.stopPropagation()
      callback(event, context)
    },
    {
      ...hotkeyOptions,
      // The wrapper applies these only after its ownership checks. TanStack's
      // defaults apply them before the callback, which would make an ignored
      // shortcut interfere with the editor that owns it.
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    }
  )
}
