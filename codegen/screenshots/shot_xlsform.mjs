// Convert an XLSForm via ODK XLSForm Online, render it in Enketo, and crop the
// first question to its presentation block.
// Usage: node shot_xlsform.mjs <xlsx_path> <out_png> [xlsform_online_url] [--other]
//
// --other: first pick the "other" choice so the conditional follow-up text
// question becomes visible; the crop then spans both questions.
//
// NOTE: this uploads the form to the public ODK XLSForm Online + Enketo staging
// services (default below). The form definition leaves this machine. Point the
// app-url argument at a self-hosted instance to keep everything local.
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/usr/lib/node_modules/playwright"));
}

const argv = process.argv.slice(2);
const showOther = argv.includes("--other");
const [xlsx, out, appUrl = "https://staging.xlsform.getodk.org/"] = argv.filter(
  (a) => !a.startsWith("--"),
);
if (!xlsx || !out) {
  console.error("usage: node shot_xlsform.mjs <xlsx_path> <out_png> [app_url] [--other]");
  process.exit(2);
}

const PAD = 16;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1000, height: 1600 },
  deviceScaleFactor: 2,
});

await page.goto(appUrl, { waitUntil: "networkidle", timeout: 60000 });
await page.locator("input[type=file]").setInputFiles(xlsx);
await page.locator('button:has-text("Submit"), input[type=submit]').first().click();
await page.waitForLoadState("networkidle");

const link = page.locator('a:has-text("Preview")');
await link.first().waitFor({ timeout: 30000 });
const href = await link.first().getAttribute("href");

await page.goto(href, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000); // Enketo renders the form client-side.

if (showOther) {
  // Selecting the "other" choice makes the relevant follow-up question appear.
  const other = page
    .locator('form.or input[value="other"], form.or input[type=text][value="other"]')
    .first();
  try {
    if (await other.count()) {
      await other.check({ timeout: 5000 });
      await page.waitForTimeout(800); // let the follow-up un-hide + animate
    }
  } catch (e) {
    console.error("warn: could not select other option:", e.message);
  }
}

// Choose the crop target:
//  * grid/matrix → the whole field-list section
//  * --other     → the union of every currently-visible question
//  * otherwise   → the single first question
let box;
const grid = page.locator("form.or section.or-appearance-field-list").first();
if (await grid.count()) {
  await grid.scrollIntoViewIfNeeded();
  box = await grid.boundingBox();
} else if (showOther) {
  const qs = page.locator("form.or .question");
  const n = await qs.count();
  for (let i = 0; i < n; i++) {
    const b = await qs.nth(i).boundingBox(); // null when hidden/not relevant
    if (!b) continue;
    box = box
      ? {
          x: Math.min(box.x, b.x),
          y: Math.min(box.y, b.y),
          width: Math.max(box.x + box.width, b.x + b.width) - Math.min(box.x, b.x),
          height: Math.max(box.y + box.height, b.y + b.height) - Math.min(box.y, b.y),
        }
      : b;
  }
} else {
  const q = page.locator("form.or .question").first();
  if (await q.count()) {
    await q.scrollIntoViewIfNeeded();
    box = await q.boundingBox();
  }
}

if (!box) {
  console.error("no Enketo question/section found");
  process.exit(1);
}
await page.screenshot({
  path: out,
  clip: {
    x: Math.max(0, box.x - PAD),
    y: Math.max(0, box.y - PAD),
    width: box.width + PAD * 2,
    height: box.height + PAD * 2,
  },
});
console.log("wrote", out);
await browser.close();
