/**
 * Scoped Tailwind config for the standalone marketing bundle
 * (src/marketing/styles/marketing.css via @config). Narrow content glob keeps
 * the render-blocking CSS small — the app's tailwind.config.js scans all of
 * src/** and produces a much larger sheet.
 */
export default {
  // + the Free plan's email page, a prerendered marketing route (src/marketing/routes.jsx)
  content: ['./marketing.html', './src/marketing/**/*.{js,jsx}', './src/briefing/Free.jsx', './src/briefing/ui.jsx'],
  theme: { extend: {} },
  plugins: [],
};
