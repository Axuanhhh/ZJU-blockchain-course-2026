import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage();
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByText(/区块 #/).waitFor();
  const observedBlocks = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(600);
    const previous = await page.locator('.block-label').innerText();
    await page.getByRole('button', { name: '↻ 刷新链上数据' }).click();
    await expect(page.locator('.block-label')).not.toHaveText(previous);
    await expect(page.getByRole('alert')).toHaveCount(0);
    observedBlocks.push(await page.locator('.block-label').innerText());
  }
  if (runtimeErrors.length) throw new Error(runtimeErrors.join('\n'));
  await writeFile('../reports/live-read-check.json', JSON.stringify({ checkedAt: new Date().toISOString(), refreshes: 12, observedBlocks, runtimeErrors, result: 'passed' }, null, 2) + '\n');
  console.log('12 consistent browser refreshes passed while the chain was changing.');
} finally { await browser.close(); }
