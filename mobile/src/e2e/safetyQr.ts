const PREFIX = 'famlin-e2e-safety:1:'

/** The text a safety-code QR carries: the 60 digits without spaces. */
export function safetyQrPayload(code: string): string {
  return PREFIX + code.replace(/ /g, '')
}

/** The digits of a scanned safety-code QR, or null when it isn't one. */
export function parseSafetyQr(data: string): string | null {
  if (!data.startsWith(PREFIX)) return null
  const digits = data.slice(PREFIX.length)
  return /^\d{60}$/.test(digits) ? digits : null
}
