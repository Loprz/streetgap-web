import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, '..', 'docs', 'screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'warn' || msg.type() === 'error') {
      console.log(`  [browser ${msg.type()}] ${msg.text().substring(0, 200)}`);
    }
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  
  console.log('Waiting for DuckDB init...');
  try {
    await page.waitForFunction(() => {
      return document.body?.textContent?.includes('IDLE');
    }, { timeout: 60000 });
  } catch {}
  await page.waitForTimeout(6000);

  // ── Screenshot 1: Overview ──
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/app-overview.png`, fullPage: false });
  console.log('✓ 1/3 app-overview.png');

  // ── Click SCAN ──
  console.log('Clicking SCAN THIS AREA...');
  const scanBtn = page.locator('button:has-text("SCAN THIS AREA")');
  await scanBtn.click({ timeout: 5000 });

  // Wait for status to go to PROCESSING first, then wait until it changes back to READY/IDLE
  console.log('Waiting for PROCESSING status...');
  try {
    await page.waitForFunction(() => {
      return document.body?.textContent?.includes('PROCESSING') || 
             document.body?.textContent?.includes('FETCHING');
    }, { timeout: 10000 });
    console.log('Processing started!');
  } catch {
    console.log('Never saw PROCESSING status');
  }

  // Now wait for it to finish (status changes from PROCESSING to READY)
  console.log('Waiting for analysis to finish...');
  try {
    await page.waitForFunction(() => {
      return document.body?.textContent?.includes('READY');
    }, { timeout: 180000 }); // 3 minutes
    console.log('Analysis complete!');
  } catch {
    console.log('Timed out — checking if data loaded anyway...');
  }
  await page.waitForTimeout(4000);

  // Check the gap count from the actual stat element
  const gapCount = await page.evaluate(() => {
    const gapsText = document.querySelector('[class*="text-pink-500"]');
    return gapsText ? gapsText.textContent : 'not found';
  });
  console.log(`Gap count: ${gapCount}`);

  // Scroll sidebar to top
  await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="overflow-y-auto"]');
    if (sidebar) sidebar.scrollTop = 0;
  });
  await page.waitForTimeout(500);

  // ── Screenshot 2: Analysis Results ──
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/analysis-results.png`, fullPage: false });
  console.log('✓ 2/3 analysis-results.png');

  // ── Screenshot 3: Scroll to show workflow ──
  await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="overflow-y-auto"]');
    if (sidebar) {
      const allH3 = sidebar.querySelectorAll('h3');
      for (const el of allH3) {
        if (el.textContent?.includes('Plan Route')) {
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          break;
        }
      }
    }
  });
  await page.waitForTimeout(1000);

  await page.screenshot({ path: `${SCREENSHOTS_DIR}/route-generation.png`, fullPage: false });
  console.log('✓ 3/3 route-generation.png');

  await browser.close();
  console.log('Done!');
})();
