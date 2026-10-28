const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:49173', headless: true, channel: process.env.CI ? undefined : 'chrome', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } }
  ],
  globalSetup: './e2e/setup.cjs'
});

