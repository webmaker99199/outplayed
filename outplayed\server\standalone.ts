import { createApp } from "./app.js";

/**
 * Standalone HTTP server for local development (`npm run dev`) and the
 * `npm start` production bundle. The serverless platforms (Vercel/Netlify)
 * import createApp() directly instead of using this file.
 */
const PORT = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
