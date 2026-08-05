// Fill out a live LimeSurvey question page as a respondent and submit it.
//
// Usage: node fill_limesurvey.mjs <spec.json>
//
// The spec is written by respondent.py:
//   {
//     "url": "http://localhost:8080/index.php/123456?newtest=Y",
//     "questions": { "<qcode>": { "qid": 42, "type": "L" } },
//     "answers":   { "<qcode>": <answer> }
//   }
//
// Answer shapes (mirrors what a respondent can do, not what the DB stores):
//   "3"                          single value  — radio by answer code, or free text
//   ["sa", "so"]                 multiple choice — tick these subquestion codes
//   { "vertrauenpolizei": "5" }  array/grid — subquestion code → answer code
//   { "other": "Zeitung" }       the built-in "other" option (tick + free text);
//                                also valid as an entry inside the array form
//
// Prints a JSON report on stdout: which fields were filled, which selectors
// found nothing (`missed`), and whether the survey reached its end page.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  // Fall back to a global install when there is no local node_modules.
  ({ chromium } = require('/usr/lib/node_modules/playwright'));
}

const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: node fill_limesurvey.mjs <spec.json>');
  process.exit(2);
}
const { readFileSync } = require('fs');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const filled = [];
const missed = [];

/** First locator in `candidates` that resolves to exactly one visible element. */
async function firstMatch(scope, candidates) {
  for (const sel of candidates) {
    const loc = scope.locator(sel).first();
    if (await loc.count()) return loc;
  }
  return null;
}

async function setValue(page, scope, selectors, value, label) {
  const loc = await firstMatch(scope, selectors);
  if (!loc) {
    missed.push({ field: label, tried: selectors });
    return;
  }
  await loc.fill(String(value));
  // Date/time questions attach a picker that only writes the submitted hidden
  // field on change/blur; Escape closes it without reverting the typed value.
  await loc.press('Escape').catch(() => {});
  await loc.evaluate((el) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  filled.push({ field: label, value: String(value) });
}

async function checkOne(page, scope, selectors, label) {
  const loc = await firstMatch(scope, selectors);
  if (!loc) {
    missed.push({ field: label, tried: selectors });
    return false;
  }
  await loc.check({ force: true });
  filled.push({ field: label, value: 'checked' });
  return true;
}

/** The built-in "Other" option: select it, then type the free text.
 *
 * Single choice exposes a real `-oth-` radio. Multiple choice has no clickable
 * box — its `…othercbox` checkbox is `aria-hidden` and LimeSurvey ticks it
 * itself once the free-text field gets a value, exactly as for a respondent who
 * just types into it.
 */
async function answerOther(page, scope, qid, text) {
  const radio = await firstMatch(scope, [`input[type=radio][value="-oth-"]`]);
  if (radio) {
    await radio.check({ force: true });
    filled.push({ field: `${qid}:other-option`, value: 'checked' });
  }
  await setValue(
    page,
    scope,
    [
      `input[type=text][id$="X${qid}othertext"]`,
      `input[type=text][id$="X${qid}other"]`,
      `input[type=text][name$="other"]`,
    ],
    text,
    `${qid}:other-text`,
  );
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
await page.goto(spec.url, { waitUntil: 'networkidle', timeout: 60000 });

// A survey may open on a welcome page; click through until questions appear.
const nextBtn = page.locator(
  '#ls-button-submit, button[value="movenext"], #movenextbtn',
);
for (let i = 0; i < 3; i++) {
  if (await page.locator('.question-container').count()) break;
  if (!(await nextBtn.count())) break;
  await nextBtn.first().click();
  await page.waitForLoadState('networkidle');
}

for (const [qcode, answer] of Object.entries(spec.answers)) {
  const meta = spec.questions[qcode];
  if (!meta) {
    missed.push({
      field: qcode,
      tried: ['unknown question code — not in list_questions'],
    });
    continue;
  }
  const qid = meta.qid;
  const scope = page.locator(`#question${qid}`);
  if (!(await scope.count())) {
    missed.push({ field: qcode, tried: [`#question${qid}`] });
    continue;
  }
  await scope.scrollIntoViewIfNeeded();

  if (Array.isArray(answer)) {
    // Multiple choice: tick one checkbox per subquestion code. An entry of
    // { "other": "…" } ticks the built-in other option and types its text.
    for (const code of answer) {
      if (code !== null && typeof code === 'object') {
        await answerOther(page, scope, qid, code.other);
        continue;
      }
      await checkOne(
        page,
        scope,
        [
          `input[type=checkbox][id$="X${qid}${code}"]`,
          `input[type=checkbox][name$="X${qid}${code}"]`,
        ],
        `${qcode}[${code}]`,
      );
    }
  } else if (answer !== null && typeof answer === 'object') {
    for (const [sub, value] of Object.entries(answer)) {
      if (sub === 'other') {
        await answerOther(page, scope, qid, value);
        continue;
      }
      // Array/grid row: radio in the `sub` row carrying answer code `value`.
      await checkOne(
        page,
        scope,
        [
          `input[type=radio][id$="X${qid}${sub}-${value}"]`,
          `input[type=radio][name$="X${qid}${sub}"][value="${value}"]`,
          `input[type=checkbox][id$="X${qid}${sub}${value}"]`,
        ],
        `${qcode}[${sub}]`,
      );
    }
  } else {
    // Single value: a choice code if the question renders options, else free text.
    const radio = await firstMatch(scope, [
      `input[type=radio][value="${answer}"]`,
      `select[name$="X${qid}"]`,
    ]);
    if (radio) {
      const tag = await radio.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') {
        await radio.selectOption(String(answer));
        filled.push({ field: qcode, value: String(answer) });
      } else {
        await radio.check({ force: true });
        filled.push({ field: qcode, value: String(answer) });
      }
    } else {
      await setValue(
        page,
        scope,
        [
          `input[type=text]:not([id$="othertext"])`,
          `input[type=number]`,
          `input[type=date]`,
          `input[type=time]`,
          `textarea`,
        ],
        answer,
        qcode,
      );
    }
  }
}

// Submit; a survey may span a confirmation click before the end page.
let submitted = false;
for (let i = 0; i < 4; i++) {
  const btn = page.locator(
    '#ls-button-submit, button[value=movesubmit], #movesubmitbtn',
  );
  if (!(await btn.count())) break;
  await btn.first().click();
  await page.waitForLoadState('networkidle');
  if (
    await page
      .locator('.completed-text, #completed-wrapper, .submit-message')
      .count()
  ) {
    submitted = true;
    break;
  }
}

const report = {
  submitted,
  filled,
  missed,
  finalUrl: page.url(),
  // Validation errors keep the respondent on the page; surface them verbatim.
  errors: await page
    .locator('.alert-danger, .ls-em-tip.error, .text-danger')
    .allTextContents()
    .then((t) => t.map((s) => s.trim()).filter(Boolean)),
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
