import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.browser.spec.js",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8765",
    browserName: "chromium",
    headless: true
  },
  webServer: {
    command: "node scripts/dev-server.mjs 8765",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});