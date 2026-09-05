import { createServerFn } from "@tanstack/react-start"
import {
  prepareEstradeckSessionImpl,
  syncEstradeckSessionImpl,
} from "@/server/estradeck"
import type { EstradeckSession, EstradeckSyncResult } from "@/server/estradeck"

export type { EstradeckSession, EstradeckSyncResult }

export const prepareEstradeckSession = createServerFn({ method: "POST" })
  .validator((data: { path: string }) => data)
  .handler(
    ({ data }): Promise<EstradeckSession> =>
      prepareEstradeckSessionImpl(data.path)
  )

export const syncEstradeckSession = createServerFn({ method: "POST" })
  .validator(
    (data: { deckId: string; file: string; deleted?: boolean }) => data
  )
  .handler(
    ({ data }): Promise<EstradeckSyncResult> =>
      syncEstradeckSessionImpl(data.deckId, data.file, data.deleted === true)
  )
