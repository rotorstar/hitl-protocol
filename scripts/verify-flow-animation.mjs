/** Browser and contract checks for the standalone, offline protocol field guide.
 * Uses the workspace's existing Playwright/AJV dependencies, without a server.
 * Run: node scripts/verify-flow-animation.mjs [--browser=webkit|firefox] [--capture]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startBrowserFixtureServer } from './browser-fixture-server.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireBrowser = createRequire(resolve(ROOT, 'implementations/agent-access/reference/package.json'));
const requireSchema = createRequire(resolve(ROOT, 'packages/schemas/package.json'));
const requireProfile = createRequire(resolve(ROOT, 'packages/agent-access/package.json'));
const canonicalize = requireProfile('canonicalize').default;
const playwright = requireBrowser('@playwright/test');
const { expect } = playwright;
const Ajv2020 = requireSchema('ajv/dist/2020.js').default;
const addFormats = requireSchema('ajv-formats').default;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schemaNames = ['form-field', 'verification-policy', 'verification-result', 'submission-context', 'hitl-object', 'poll-response', 'submit-request'];
const schemas = new Map();
for (const name of schemaNames) {
  const schema = JSON.parse(await readFile(resolve(ROOT, `schemas/${name}.schema.json`), 'utf8'));
  schemas.set(name, schema);
  ajv.addSchema(schema, `${name}.json`);
}
const validateHitl = ajv.compile(schemas.get('hitl-object'));
const validatePoll = ajv.compile(schemas.get('poll-response'));
const validateSubmit = ajv.compile(schemas.get('submit-request'));
const profile = JSON.parse(await readFile(resolve(ROOT, 'profiles/agent-access/v0.1/agent-access-context.schema.json'), 'utf8'));
const validateProfile = ajv.compile(profile);
const openapi = JSON.parse(await readFile(resolve(ROOT, 'profiles/agent-access/v0.1/openapi.json'), 'utf8'));
const validateCommit = ajv.compile(openapi.components.schemas.CommitInput);
const validateSnapshot = ajv.compile(openapi.components.schemas.OfferSnapshot);
let url = pathToFileURL(resolve(ROOT, 'assets/hitl-protocol-flow.html')).href;
const browserName = process.argv.find((arg) => arg.startsWith('--browser='))?.split('=')[1] || 'chromium';
assert(['chromium', 'webkit', 'firefox'].includes(browserName), 'Choose chromium, webkit or firefox');
// WebKit on macOS cannot reliably load files outside its application container.
// Use a loopback-only fixture server for that engine; prohibit external requests.
let server;
const useHTTP = browserName === 'webkit' || process.argv.includes('--http');
if (useHTTP) {
  const fixture = await startBrowserFixtureServer(ROOT);
  server = fixture.server;
  url = `${fixture.origin}/assets/hitl-protocol-flow.html`;
}
const browser = await playwright[browserName].launch();
const errors = [];
const network = [];
let messages = 0;
let scenarios = 0;

function valid(validator, body, context) {
  assert(validator(body), `${context}: ${JSON.stringify(validator.errors)}`);
}
async function visit(page, hash = '') {
  await page.goto(`${url}${hash}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => ['Inter', 'JetBrains Mono'].every(name => [...document.fonts].some(face => face.family.replace(/["']/g, '') === name && face.status === 'loaded'))), 'Both bundled fonts must load');
  await expect(page.locator('#explorer')).toBeVisible();
}
async function readPayload(page) {
  return JSON.parse(await page.locator('#payload').textContent());
}
async function noOverflow(page, context) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow: ${context}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce', offline: !useHTTP });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(new URL(url).origin + '/')) network.push(request.url()); });
  await visit(page);
  await expect(page).toHaveTitle(/v0\.9/);
  await expect(page.locator('#steps button')).toHaveCount(9);
  await expect(page.locator('#previous')).toBeDisabled();

  // Story tabs are discoverable, correctly labelled and independent of step navigation.
  await expect(page.locator('#story-tabs [role="tab"]')).toHaveText(['Job search', 'Shopping', 'Research']);
  await visit(page, '#story=jobs&flow=browser&step=6');
  await page.locator('[data-story="jobs"]').click();
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '6');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-story="purchase"]')).toBeFocused();
  await expect(page.locator('[data-story="purchase"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#story-panel-purchase')).toBeVisible();
  await expect(page.locator('#story-panel-purchase')).toHaveAttribute('aria-labelledby', 'story-tab-purchase');
  await expect(page.locator('#story-panel-jobs')).toBeHidden();
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '1');
  assert(new URL(page.url()).hash.includes('story=purchase'), 'The URL records the selected story tab');
  await page.keyboard.press('End');
  await expect(page.locator('[data-story="research"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-story="jobs"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-story="research"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-story="jobs"]')).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.press('Space');
  await expect(page.locator('[data-story="jobs"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('Tab');
  await expect(page.locator('#story-panel-jobs')).toBeFocused();
  await visit(page, '#story=jobs&flow=inline&outcome=declined&step=4');
  await page.locator('#play').click();
  await page.locator('[data-story="research"]').click();
  await expect(page.locator('[data-flow="inline"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#play-label')).toHaveText('Play flow');
  await expect(page.locator('#outcome')).toHaveValue('success');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '1');
  await page.reload();
  await expect(page.locator('[data-story="research"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#story-tabs [tabindex="0"]')).toHaveCount(1);

  // Walk every advertised branch and validate actual displayed wire bodies.
  // The expected review/operation distinctions are normative acceptance criteria.
  for (const story of ['jobs','research','purchase']) for (const flow of ['browser', 'inline', 'access']) {
    if(flow === 'access' && story !== 'jobs') continue;
    if(await page.locator('#story-tabs').isHidden()) await page.locator('[data-flow="browser"]').click();
    await page.locator(`[data-story="${story}"]`).click();
    await page.locator(`[data-flow="${flow}"]`).click();
    const outcomes = await page.locator('#outcome option').evaluateAll((options) => options.map((option) => option.value));
    for (const outcome of outcomes) {
      await page.locator('#outcome').selectOption(outcome);
      await page.locator('#reset').click();
      const count = await page.locator('#steps button').count();
      let recordedDecision = false;
      let seenCommit = false;
      for (let index = 0; index < count; index++) {
        await page.locator(`#steps button[data-step="${index}"]`).click();
        const payload = await readPayload(page);
        const label = await page.locator('#payload-label').textContent();
        const status = await page.locator('#case-status').getAttribute('data-status');
        if (payload.hitl) {
          valid(validateHitl, payload.hitl, `${flow}/${outcome} HITL object`);
          if (flow === 'access') {
            valid(validateProfile, payload.hitl.context['x-hitl-agent-access'], 'Agent Access context');
            assert(!Object.hasOwn(payload.hitl, 'submit_url'), 'Profile must not offer inline submit');
            assert.equal(payload.hitl.default_action, 'abort');
          }
          messages++;
        }
        if (label.includes('PollResponse') || label.includes('optional opened') || label.includes('optional progress')) {
          valid(validatePoll, payload, `${flow}/${outcome} poll`);
          assert.equal(payload.status, status, 'Scene status must match the displayed poll');
          if (payload.status === 'completed') recordedDecision = true;
          if (['expired', 'cancelled'].includes(payload.status)) assert(!payload.result, 'No result without an accepted decision');
          messages++;
        }
        if (label.includes('SubmitRequest')) { valid(validateSubmit, payload, 'Inline SubmitRequest'); messages++; }
        if (label.includes('reference request body')) {
          valid(validateCommit, payload, 'Agent Access commit');
          assert(recordedDecision, 'Commit must follow a recorded owner decision');
          assert.equal(payload.expected_version, 1, 'Reference confirmation changes review version, not operation version');
          seenCommit = true; messages++;
        }
        if (payload.status === 'succeeded') assert(seenCommit && recordedDecision, 'Execution must follow decision AND explicit commit');
        if (payload.snapshot) {
          valid(validateSnapshot, payload.snapshot, 'Prepared snapshot');
          assert.equal(payload.snapshot.total_cents, payload.snapshot.unit_price_cents * payload.snapshot.quantity + payload.snapshot.fee_cents);
          assert.equal(payload.snapshot_digest, createHash('sha256').update(canonicalize(payload.snapshot)).digest('hex'), 'The displayed snapshot digest must bind the actual displayed terms');
        }
        await noOverflow(page, `${flow}/${outcome}/${index}`);
        // Respect WebKit’s browser-level History API frequency limit during this automated sweep.
        if (browserName === 'webkit') await page.waitForTimeout(170);
      }
      await expect(page.locator('#next')).toBeDisabled();
      const expectedReview = ['expired', 'cancelled'].includes(outcome) ? outcome : 'completed';
      await expect(page.locator('#case-status')).toHaveAttribute('data-status', expectedReview);
      if (flow === 'access') {
        const final = await readPayload(page);
        assert.equal(final.status, { success: 'succeeded', declined: 'cancelled', revoked: 'cancelled', changed: 'superseded', expired: 'expired' }[outcome]);
        if (outcome !== 'success') assert.equal(final.booking, null, 'Refused execution must create no booking');
        if (outcome === 'declined') {
          await page.locator('#steps button[data-step="6"]').click();
          const decision = await readPayload(page);
          assert.equal(decision.status, 'completed'); assert.equal(decision.result.action, 'cancel');
        }
      }
      scenarios++;
    }
  }

  // Deep-link restoration, malformed inputs and browser history.
  await visit(page, '#flow=access&outcome=revoked&step=9');
  await expect(page.locator('#step-title')).toHaveText('Stop: permission was withdrawn');
  await page.reload();
  await expect(page.locator('#step-title')).toHaveText('Stop: permission was withdrawn');
  await visit(page, '#flow=__proto__&outcome=unknown&step=NaN');
  await expect(page.locator('[data-flow="browser"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '1');
  await visit(page, '#flow=inline&step=999');
  await expect(page.locator('#next')).toBeDisabled();
  await visit(page, '#flow=browser&step=-2');
  await expect(page.locator('#previous')).toBeDisabled();
  await visit(page, '#flow=browser&step=3');
  await visit(page, '#flow=access&step=7');
  await page.goBack();
  await expect(page.locator('#step-title')).toHaveText('Ask for your choice');

  // The messenger must make the handoff and native buttons visible in the diagram.
  await visit(page, '#flow=browser&step=4');
  await expect(page.locator('.channel-button')).toHaveText('Open review ↗');
  await visit(page, '#flow=inline&step=4');
  await expect(page.locator('#channel-body .demo-action')).toHaveText(['Confirm', 'Cancel', 'Details ↗']);
  await page.locator('#channel-body [data-demo-action="cancel"]').click();
  await expect(page.locator('#outcome')).toHaveValue('declined');
  await page.locator('#next').click(); await page.locator('#next').click();
  assert.equal((await readPayload(page)).result.action, 'cancel');
  await expect(page.locator('#case-status')).toHaveAttribute('data-status', 'completed');
  for(const action of ['confirm','cancel','details']) await expect(page.locator(`#channel-body [data-demo-action="${action}"]`)).toBeDisabled();

  // Friendly labels, interactive choices and a concrete follow-up for each story.
  for(const story of ['jobs','research','purchase']) {
    await visit(page, `#story=${story}&flow=browser&step=6`);
    await expect(page.locator('#scene [data-choice]')).toHaveCount(3);
    assert(!/job-tc-|job-dx-|source-|product-/.test(await page.locator('#scene').innerText()),'Internal IDs must not be visible in the review graphic');
    const option = page.locator('#scene [data-choice]').nth(2);
    const id = await option.getAttribute('data-choice');
    await option.click();
    await page.locator('[data-review-action="submit"]').click();
    await expect(page.locator('#case-status')).toHaveAttribute('data-status','completed');
    assert((await readPayload(page)).data.selected.includes(id),'The stored result must reflect the human selection');
    if(story === 'purchase') assert.equal((await readPayload(page)).data.selected.length,1,'Product choice is singular');
    await expect(page.locator('#scene [data-choice]').nth(2)).toBeDisabled();
    await page.reload(); assert((await readPayload(page)).data.selected.includes(id),'Shared URL must restore the exact selection');
    await expect(page.locator(`[data-story="${story}"]`)).toHaveAttribute('aria-selected','true');
    await page.locator('#scene [data-review-action="followup"]').click();
    await expect(page.locator('[data-flow="inline"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#channel-body')).toContainText(story === 'jobs' ? 'application drafts' : story === 'research' ? 'comparison' : 'order summary');
  }

  // Touch layouts, zoom-equivalent reflow, light/dark and high contrast.
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const flow of ['browser', 'inline', 'access']) {
      await visit(page, `#flow=${flow}&step=4`);
      await noOverflow(page, `${width}px ${flow}`);
      if (flow !== 'access') {
        const boxes = await page.locator('#story-tabs [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => {
          const { x, y, width, height } = tab.getBoundingClientRect();
          return { x, y, width, height, clipped: tab.scrollWidth > tab.clientWidth };
        }));
        assert(boxes.every((box) => Math.abs(box.y - boxes[0].y) < 1 && box.width > 0 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width && !box.clipped), `All three story tabs must stay horizontal, visible and readable at ${width}px`);
      }
      const diagram = await page.locator('#architecture').boundingBox(), review = await page.locator('#scene').boundingBox();
      assert(review.y + review.height <= diagram.y + diagram.height + 1, `Review card must remain inside the diagram at ${width}px ${flow}`);
      await page.locator('#theme').selectOption('dark');
      await noOverflow(page, `${width}px ${flow} dark`);
      await page.locator('#theme').selectOption('light');
    }
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('#next')).toBeVisible();
  await page.emulateMedia({ forcedColors: 'none' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#focus-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-focus', 'true');
  await expect(page.locator('.hero')).toBeHidden();
  await noOverflow(page, 'focus view');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-focus', 'false');
  await expect(page.locator('.hero')).toBeVisible();

  // Real timer behavior with Playwright's clock, including pause and replay.
  await page.clock.install();
  await visit(page);
  await expect(page.locator('#reduce-motion')).toBeChecked();
  assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0, 'Reduced motion must stop all animation');
  await page.locator('#speed').selectOption('2');
  await page.locator('#play').click();
  await page.clock.runFor(2601);
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '2');
  await page.locator('#play').click();
  await page.clock.runFor(20000);
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '2');
  await page.locator('#play').click();
  await page.clock.runFor(20000);
  await expect(page.locator('#next')).toBeDisabled();
  await expect(page.locator('#play-label')).toHaveText('Replay flow');
  await page.locator('#play').click();
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '1');
  await page.locator('#next').click();
  await page.clock.runFor(10000);
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '2');
  await page.locator('#next').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '2');
  await page.locator('#speed').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '2');

  if (useHTTP) await context.setOffline(true);

  // Clipboard failure must give an actionable fallback instead of a silent error.
  await page.locator('#inspect-toggle').click();
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#inspect-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.locator('#copy-payload').click();
  await expect(page.locator('#playback-status')).toContainText('payload is selected');
  assert.equal(await page.evaluate(() => getSelection().toString()), await page.locator('#payload').textContent());
  await page.locator('#share').click();
  await expect(page.locator('#playback-status')).toContainText('address bar');
  assert.deepEqual(errors, [], 'No browser or console errors');
  assert.deepEqual(network, [], 'The standalone animation must work offline without external requests');

  // No-JS transcript preserves the core explanation and source links.
  const noJS = await browser.newContext({ javaScriptEnabled: false, offline: !useHTTP });
  const staticPage = await noJS.newPage();
  await staticPage.goto(url);
  // Playwright's text matcher deliberately skips noscript; read its DOM text directly.
  assert((await staticPage.locator('noscript').textContent()).includes('fresh, explicit commit'));
  await expect(staticPage.locator('noscript')).toBeVisible();
  await expect(staticPage.locator('#explorer')).toBeHidden();
  await noJS.close();

  // Motion-enabled operation is checked separately from the reduced-motion path.
  const animatedContext = await browser.newContext({ viewport: { width: 1440, height: 1120 }, colorScheme: 'light', reducedMotion: 'no-preference', offline: !useHTTP });
  const animatedPage = await animatedContext.newPage();
  animatedPage.on('pageerror', (error) => errors.push(error.message));
  await visit(animatedPage);
  await animatedPage.locator('#play').click();
  await animatedPage.locator('#play').click();
  // Let the button's short hover feedback settle; diagram motion must remain paused.
  await animatedPage.waitForTimeout(300);
  assert.equal(await animatedPage.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0, 'Pause must freeze motion as well as playback');
  await animatedPage.locator('#reduce-motion').check();
  await animatedPage.locator('#next').click();
  assert.equal(await animatedPage.evaluate(() => document.getAnimations().length), 0, 'Manual motion reduction must suppress WAAPI and CSS motion');

  if (process.argv.includes('--capture')) {
    await mkdir(resolve(ROOT, 'assets'), { recursive: true });
    await visit(animatedPage, '#story=jobs&flow=browser&step=6');
    await animatedPage.locator('#reduce-motion').check();
    await animatedPage.evaluate(() => scrollTo(0, 0));
    for (const theme of ['light', 'dark']) {
      await animatedPage.locator('#theme').selectOption(theme);
      await animatedPage.evaluate(() => scrollTo(0, 0));
      await animatedPage.screenshot({ path: resolve(ROOT, `assets/hitl-flow-v0.9${theme === 'dark' ? '-dark' : ''}.png`), fullPage: true });
      await animatedPage.locator('#explorer').screenshot({ path: resolve(ROOT, `assets/hitl-flow-v0.9-preview${theme === 'dark' ? '-dark' : ''}.png`), animations: 'disabled' });
    }
    await animatedPage.locator('#theme').selectOption('light');
    for(const story of ['research','purchase']) {
      await visit(animatedPage, `#story=${story}&flow=browser&step=9`);
      await animatedPage.evaluate(() => scrollTo(0,0));
      await animatedPage.screenshot({path: resolve(ROOT,`docs/animation-review/${story}.png`),fullPage:true});
    }
    await visit(animatedPage, '#story=jobs&flow=inline&step=4');
    await animatedPage.evaluate(() => scrollTo(0,0));
    await animatedPage.screenshot({path:resolve(ROOT,'docs/animation-review/messenger.png'),fullPage:true});
    await visit(animatedPage, '#story=jobs&flow=browser&step=6');
    await animatedPage.setViewportSize({ width: 390, height: 844 });
    await animatedPage.screenshot({ path: '/tmp/hitl-flow-mobile-final.png', fullPage: true });
    await animatedPage.locator('#architecture').screenshot({path:'/tmp/hitl-flow-mobile-architecture.png'});
  }
  assert.deepEqual(errors, [], 'No motion-path errors');
  await animatedContext.close(); await context.close();
  console.log(`${browserName}: PASS — ${scenarios} outcomes, ${messages} schema-valid wire messages; offline, URL/history, player, keyboard, clipboard fallback, mobile, themes, reduced motion and no-JS transcript.`);
} finally { await browser.close(); if (server) await new Promise((done) => server.close(done)); }
