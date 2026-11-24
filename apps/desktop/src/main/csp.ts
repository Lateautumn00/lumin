export const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' file: data: blob:",
  "media-src 'self' file: blob: data: lumin-media:",
  "font-src 'self' data:",
  "connect-src 'self' ws:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ')

export const PROD_CSP = [
  "default-src 'self' file: data:",
  "script-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data: blob:",
  "media-src 'self' file: blob: data: lumin-media:",
  "font-src 'self' file: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self' file:",
  "form-action 'none'"
].join('; ')
