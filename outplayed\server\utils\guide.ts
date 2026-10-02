/**
 * Button-only setup guide page (server-rendered).
 *
 * GET /guide serves this HTML directly — no SPA route needed. It contains a
 * single "Join Discord" button pointing at the site's invite; all setup,
 * tickets and support happen in Discord.
 */

export function renderGuidePage(siteName: string, inviteUrl: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Setup Guide — ${esc(siteName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: #0a0a19; color: #fff; padding: 24px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card { width: 100%; max-width: 480px; text-align: center; }
  .eyebrow {
    font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(255,255,255,0.5);
  }
  h1 { margin-top: 12px; font-size: 32px; font-weight: 700; letter-spacing: -0.01em; }
  p { margin-top: 12px; font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.6); }
  .join {
    margin-top: 28px; display: inline-flex; width: 100%; align-items: center; justify-content: center; gap: 8px;
    background: #5865f2; color: #fff; text-decoration: none;
    font-size: 15px; font-weight: 600; padding: 14px 20px; border-radius: 16px;
    box-shadow: 0 20px 45px -28px rgba(88,101,242,0.95); transition: background 0.15s ease;
  }
  .join:hover { background: #6772f6; }
  .back { margin-top: 16px; display: inline-block; font-size: 13px; color: rgba(255,255,255,0.5); text-decoration: none; }
  .back:hover { color: rgba(255,255,255,0.85); }
</style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Setup Guide</div>
    <h1>${esc(siteName)} Setup</h1>
    <p>Everything — setup, support and tickets — happens in our Discord server. Join below to get started.</p>
    <a class="join" href="${esc(inviteUrl)}" target="_blank" rel="noreferrer">Join Discord</a>
    <br />
    <a class="back" href="/">← Back to home</a>
  </main>
</body>
</html>`;
}
