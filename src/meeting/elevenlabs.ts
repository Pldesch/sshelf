/* ElevenLabs Scribe v2 Realtime protocol details, shared by the meeting page
   (browser) and the CLI. */

export const SAMPLE_RATE = 16000

/** Errors that reconnecting cannot fix. */
export const FATAL_STT_ERRORS = new Set([
  "auth_error",
  "quota_exceeded",
  "unaccepted_terms",
])

/** Realtime websocket URL; `languages[0]` is the main language. Pass a
 * single-use `token` when the API key can't be sent as a header. */
export function realtimeUrl(languages: Array<string>, token?: string) {
  const params = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    audio_format: `pcm_${SAMPLE_RATE}`,
    commit_strategy: "vad",
  })
  if (token) params.set("token", token)
  const [main, ...secondary] = languages
  if (main) params.set("language_code", main)
  for (const lang of secondary) params.append("secondary_languages", lang)
  return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`
}

/** One websocket message carrying base64 PCM audio. */
export function audioChunkMessage(base64: string, commit = false) {
  return JSON.stringify({
    message_type: "input_audio_chunk",
    audio_base_64: base64,
    commit,
    sample_rate: SAMPLE_RATE,
  })
}
