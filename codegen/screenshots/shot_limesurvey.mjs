// Screenshot a single LimeSurvey question and crop to its presentation block.
// Usage: node shot_limesurvey.mjs <survey_url> <out_png> [--other] [--picker]
//
// --other: first select the built-in "Other" option so its free-text input is
// visible in the shot (used for the select_*_other example types).
//
// --picker: open the date/time picker before shooting (used for date/time
// types). Closed, every `D` question shows the same static calendar glyph
// whatever its date_format, so the shot cannot show whether it accepts a date
// or a time — open, a `date_format: HH:MM` question reveals an HH:MM spinner.
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  // Fall back to a global install when there is no local node_modules.
  ({ chromium } = require("/usr/lib/node_modules/playwright"));
}

const argv = process.argv.slice(2);
const showOther = argv.includes("--other");
const openPicker = argv.includes("--picker");
const [url, out] = argv.filter((a) => !a.startsWith("--"));
if (!url || !out) {
  console.error(
    "usage: node shot_limesurvey.mjs <survey_url> <out_png> [--other] [--picker]",
  );
  process.exit(2);
}

const PAD = 16;

const browser = await chromium.launch();
const page = await browser.newPage({
  // Wide enough that array/matrix questions render as a table, not stacked.
  viewport: { width: 1400, height: 1600 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

// A survey may open on a welcome page; click through until questions appear.
const nextBtn = page.locator('#ls-button-submit, button[value="movenext"], #movenextbtn');
for (let i = 0; i < 3; i++) {
  if (await page.locator(".question-container, .ls-answers, .answer-container").count()) break;
  if (await nextBtn.count()) {
    await nextBtn.first().click();
    await page.waitForLoadState("networkidle");
  }
}

const q = page.locator(".question-container").first();
if (!(await q.count())) {
  console.error("no .question-container found");
  process.exit(1);
}

if (showOther) {
  // LimeSurvey renders the "Other" free-text field inline and always visible,
  // so the input already shows without interaction. As a nicety we also tick
  // the option (works for the radio; the multiple-choice proxy checkbox may not
  // toggle in this theme). Best-effort — never fail the shot over it.
  const other = q
    .locator(
      '.other-item input[type=radio], .other-item input[type=checkbox], ' +
        'input[value="-oth-"], .answer-item:last-child input[type=radio], ' +
        '.answer-item:last-child input[type=checkbox]',
    )
    .first();
  try {
    if (await other.count()) {
      await other.check({ timeout: 4000 });
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.error("warn: could not tick other option (input still shown):", e.message);
  }
}

// Date/time questions render as a closed text input with a *static calendar
// glyph* regardless of their date_format — so a closed-widget shot of a
// time-only question looks identical to a date question and reads as a bug.
// Opening the picker is the only way the shot shows the real input mode
// (a HH:MM spinner for `date_format: HH:MM`, a calendar grid for a date).
let pickerBox = null;
if (openPicker) {
  try {
    const trigger = q
      .locator('.input-group-addon, .input-group-text, button.btn-datepicker')
      .first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 5000 });
    } else {
      await q.locator('input[type=text]').first().click({ timeout: 5000 });
    }
    // The widget is appended outside .question-container, so capture its box
    // separately and union it into the clip below. Wait for it to be *visible*
    // (not merely attached) or its box measures short and the clip cuts it off.
    // LimeSurvey 6 ships Tempus Dominus; the older names cover 3.x/5.x themes.
    const widget = page
      .locator(
        '.tempus-dominus-widget.show, .bootstrap-datetimepicker-widget, ' +
          '.xdsoft_datetimepicker, .datepicker',
      )
      .first();
    await widget.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(600); // let the open animation settle
    const b = await widget.boundingBox();
    if (b && b.height > 20) pickerBox = b;
    else console.error("warn: picker box too small to include:", JSON.stringify(b));
  } catch (e) {
    console.error("warn: could not open date/time picker:", e.message);
  }
}

await q.scrollIntoViewIfNeeded();
const box = await q.boundingBox();
// Union the question block with the open picker so both are in frame.
const minX = pickerBox ? Math.min(box.x, pickerBox.x) : box.x;
const minY = pickerBox ? Math.min(box.y, pickerBox.y) : box.y;
const maxX = pickerBox
  ? Math.max(box.x + box.width, pickerBox.x + pickerBox.width)
  : box.x + box.width;
const maxY = pickerBox
  ? Math.max(box.y + box.height, pickerBox.y + pickerBox.height)
  : box.y + box.height;
await page.screenshot({
  path: out,
  clip: {
    x: Math.max(0, minX - PAD),
    y: Math.max(0, minY - PAD),
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
  },
});
console.log("wrote", out);
await browser.close();
