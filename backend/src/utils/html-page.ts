import { SupportedLanguage } from '../i18n/index.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Matches the app's Logo component (mobile/src/components/Logo.tsx): a
// teal-gradient rounded square with a white house glyph.
export const LOGO_SVG = `<svg width="56" height="56" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="famlinLogoGradient" x1="0%" y1="0%" x2="85%" y2="100%">
      <stop offset="0" stop-color="#318ea2" />
      <stop offset="1" stop-color="#005480" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="10.6" fill="url(#famlinLogoGradient)" />
  <path d="M24 6 Q25.6 6 26.9 6.95 L40.4 17.4 Q42 18.65 42 20.7 L42 38 Q42 42 38 42 L10 42 Q6 42 6 38 L6 20.7 Q6 18.65 7.6 17.4 L21.1 6.95 Q22.4 6 24 6 Z" fill="white" />
  <circle cx="24" cy="20.5" r="2.6" fill="#006e94" />
  <path d="M18.5 42 L18.5 31 Q18.5 26 24 26 Q29.5 26 29.5 31 L29.5 42 Z" fill="#006e94" />
</svg>`;

export function htmlPage(lang: SupportedLanguage, title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #edf7fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f222a; }
  .card { max-width: 420px; margin: 24px; padding: 32px 28px; background: #FFFFFF; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); text-align: center; }
  .logo { margin: 0 0 20px; }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 8px; color: #006e94; }
  p { font-size: 15px; line-height: 1.5; color: #597784; margin: 0 0 20px; }
  .button { display: inline-block; width: 100%; box-sizing: border-box; padding: 14px 20px; border-radius: 100px; background: #006e94; color: #fff; text-decoration: none; font-weight: 700; font-size: 16px; }
  .store-links { display: flex; gap: 8px; margin-top: 10px; }
  .store-button { flex: 1; box-sizing: border-box; padding: 11px 12px; border-radius: 100px; background: #edf7fb; color: #006e94; border: 1px solid #d9e3e7; text-decoration: none; font-weight: 700; font-size: 13px; }
  .hint { margin-top: 16px; font-size: 13px; color: #597784; }
  .status { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 20px; padding: 6px 14px; border-radius: 100px; background: #e4f6ea; color: #1c7a42; font-weight: 700; font-size: 13px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #2fb463; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">${LOGO_SVG}</div>
    ${body}
  </div>
</body>
</html>`;
}
