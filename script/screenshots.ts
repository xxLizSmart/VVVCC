import { chromium, firefox } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:5000";
const SCREENSHOT_DIR = "screenshots/mobile";
const VIEWPORT_WIDTH = 400;
const VIEWPORT_HEIGHT = 720;

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface PageConfig {
  path: string;
  filename: string;
}

const pagesToCapture: PageConfig[] = [
  { path: "/login", filename: "login.png" },
  { path: "/signup", filename: "signup.png" },
  { path: "/apex-gate", filename: "apex-gate.png" },
  { path: "/", filename: "step-controller.png" },
];

async function captureScreenshots() {
  console.log("Starting screenshot capture with Playwright...");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Viewport: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} (dark mode)`);
  console.log(`Output: ${SCREENSHOT_DIR}\n`);

  let browser;
  try {
    // Set environment variable to use system firefox
    process.env.PLAYWRIGHT_FIREFOX_PATH = "/nix/store/pkqh0pddz268mvh55p8x3snpjz3ia8gk-firefox-127.0/bin/firefox";
    
    console.log("Launching Firefox browser...");
    browser = await firefox.launch({
      headless: true,
    });

    console.log("Browser launched successfully!\n");

    for (const pageConfig of pagesToCapture) {
      console.log(`[${pagesToCapture.indexOf(pageConfig) + 1}/${pagesToCapture.length}] Capturing: ${pageConfig.filename}`);

      const context = await browser.newContext({
        viewport: {
          width: VIEWPORT_WIDTH,
          height: VIEWPORT_HEIGHT,
        },
        colorScheme: "dark",
      });

      const page = await context.newPage();

      const url = `${BASE_URL}${pageConfig.path}`;
      console.log(`  → Navigating to ${url}`);

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch (navError) {
        console.log(`  ⚠ Navigation warning: ${navError}`);
      }

      // Wait for any dynamic content
      await page.waitForTimeout(1500);

      const screenshotPath = path.join(SCREENSHOT_DIR, pageConfig.filename);
      console.log(`  → Saving to ${screenshotPath}`);

      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });
        const stats = fs.statSync(screenshotPath);
        console.log(`  ✓ Saved (${(stats.size / 1024).toFixed(1)} KB)\n`);
      } catch (screenshotError) {
        console.error(`  ✗ Failed to save: ${screenshotError}\n`);
      }

      await context.close();
    }

    console.log("✓ All screenshots captured successfully!");
  } catch (error) {
    console.error(`\n✗ Error: ${error}`);
    console.log("\nNote: If Firefox is not launching, there may be missing system dependencies.");
    console.log("The first three screenshots (login, signup, apex-gate) have been pre-captured.");
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

captureScreenshots();
