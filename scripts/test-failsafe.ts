/* Verifies the offline fallback: warm the cache, point the module at an
   unreachable host, and check that stale data is served fast. */
import { fetchTree, readRemoteFile, setSshHost } from "../src/server/ssh"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The module no longer assumes a default host — pick one explicitly.
// Override the real host with EXPLORER_SSH_HOST when running this test.
const TEST_HOST = process.env.EXPLORER_SSH_HOST || "ovh-codex"
setSshHost(TEST_HOST)

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t0 = performance.now()
  try {
    const value = await fn()
    console.log(`${label}: ok in ${Math.round(performance.now() - t0)}ms`)
    return value
  } catch (error) {
    console.log(
      `${label}: THREW in ${Math.round(performance.now() - t0)}ms — ${(error as Error).message}`,
    )
    return null
  }
}

// 1. warm the cache against the real host
const warm = await timed("warm fetchTree", fetchTree)
console.log(
  `   entries=${warm?.value.length}, stale=${String(warm?.stale)}`,
)
await timed("warm readRemoteFile AGENTS.md", () =>
  readRemoteFile("Process/AGENTS.md"),
)

// 2. break the connection
setSshHost("unreachable-host-for-failsafe-test.invalid")
console.log("…waiting 31s for the tree cache TTL to expire…")
await sleep(31_000)

// 3. first call after outage: slow (timeout+retry), must fall back to stale
const stale = await timed("offline fetchTree (expect stale fallback)", fetchTree)
console.log(`   entries=${stale?.value.length}, stale=${String(stale?.stale)}`)

// 4. circuit breaker open: must return stale data fast
const fast = await timed("offline fetchTree again (expect fast)", fetchTree)
console.log(`   stale=${String(fast?.stale)}`)

// 5. cached file still readable offline
const file = await timed("offline readRemoteFile cached", () =>
  readRemoteFile("Process/AGENTS.md"),
)
console.log(`   stale=${String(file?.stale)}, bytes=${file?.value.byteLength}`)

// 6. uncached file offline: should fail fast, not hang
await timed("offline readRemoteFile UNCACHED (expect fast error)", () =>
  readRemoteFile("Process/CONTEXT.md"),
)

// 7. recovery
setSshHost(TEST_HOST)
console.log("…waiting 11s for the circuit breaker to close…")
await sleep(11_000)
const back = await timed("recovered fetchTree", fetchTree)
console.log(`   stale=${String(back?.stale)}`)
