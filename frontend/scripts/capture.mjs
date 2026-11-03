import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByText(/区块 #/).waitFor();
  await page.getByRole('button', { name: '连接所选账户 ↗' }).click();
  await page.getByRole('button', { name: /断开/ }).waitFor();
  await expect(page.getByRole('button', { name: /断开/ })).toBeEnabled();
  await expect(page.locator('.stat').nth(1).locator('strong')).not.toHaveText('0ETH');
  await page.locator('.accent-stat strong').filter({ hasText: '300' }).waitFor();
  await page.getByTestId('swap-output').filter({ hasNotText: '—' }).waitFor();
  await page.screenshot({ path: '../docs/screenshots/01-exchange.png', fullPage: true });
  await page.getByRole('button', { name: /链上活动/ }).click();
  await page.getByRole('heading', { name: '20 用户模拟验收' }).waitFor();
  await page.screenshot({ path: '../docs/screenshots/05-simulation.png', fullPage: true });
  const summary = await page.locator('.simulation-summary').innerText();
  if (!summary.includes('20')) throw new Error('Expected 20 participating users');
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile('../reports/ui-smoke.json', JSON.stringify({ checkedAt: new Date().toISOString(), browser: await browser.version(), runtimeErrors: errors, summary, screenshots: ['01-exchange.png', '05-simulation.png'] }, null, 2) + '\n');
  console.log('Verified current report in browser and saved exchange/simulation screenshots.');
} finally { await browser.close(); }
