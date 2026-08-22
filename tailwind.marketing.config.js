/**
 * Scoped Tailwind config for the standalone marketing bundle
 * (src/marketing/styles/marketing.css via @config). Narrow content glob keeps
 * the render-blocking CSS small — the app's tailwind.config.js scans all of
 * src/** and produces a much larger sheet.
 */
export default {
  content: ['./marketing.html', './src/marketing/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
