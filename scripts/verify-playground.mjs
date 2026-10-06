/** Checks actual rendered playground fixtures against the canonical v0.9 wire schemas.
 * Run: node scripts/verify-playground.mjs [--capture]
 */
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireBrowser = createRequire(resolve(ROOT,'implementations/agent-access/reference/package.json'));
const requireSchema = createRequire(resolve(ROOT,'packages/schemas/package.json'));
const playwright = requireBrowser('@playwright/test');
const { expect } = playwright;
const Ajv = requireSchema('ajv/dist/2020.js').default;
const ajv = new Ajv({strict:false,allErrors:true});
requireSchema('ajv-formats').default(ajv);
const validators = new Map();
for (const name of ['form-field','verification-policy','verification-result','submission-context','hitl-object','poll-response','submit-request']) {
  const schema = JSON.parse(await readFile(resolve(ROOT,`schemas/${name}.schema.json`),'utf8'));
  ajv.addSchema(schema,`${name}.json`); validators.set(name,ajv.compile(schema));
}
let url = pathToFileURL(resolve(ROOT,'playground/index.html')).href;
const browserName = process.argv.find(arg => arg.startsWith('--browser='))?.split('=')[1] || 'chromium';
assert(['chromium','webkit','firefox'].includes(browserName));
let server;
if (browserName === 'webkit') {
  server = createServer(async (request,response) => {
    const file = request.url?.startsWith('/assets/logo.svg') ? 'assets/logo.svg' : 'playground/index.html';
    response.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(await readFile(resolve(ROOT,file)));
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  url = `http://127.0.0.1:${server.address().port}/playground/index.html`;
}
const browser = await playwright[browserName].launch();
let messages = 0, configurations = 0;
const errors = [];
const wireStatuses = ['pending','opened','in_progress','completed','expired','cancelled'];
function validate(name,value,label) {
  const validator = validators.get(name);
  assert(validator(value),`${label}: ${JSON.stringify(validator.errors)}`);
  messages++;
}
async function examples(page) {
  return page.locator('.section.active .json-block').evaluateAll(blocks => blocks.map(block => {
    const clone = block.cloneNode(true); clone.querySelectorAll('button').forEach(button => button.remove());
    const text = clone.textContent.trim();
    return {id:block.id,text};
  }).filter(block => block.text.startsWith('{')).map(block => ({id:block.id,value:JSON.parse(block.text)})));
}
async function check(page,label) {
  const objects = await examples(page);
  const cases = [];
  for (const {id,value} of objects) {
    const hitl = value.hitl || (value.spec_version ? value : null);
    if (hitl) { validate('hitl-object',hitl,`${label}/${id}`); cases.push(hitl); }
    let poll = wireStatuses.includes(value.status) ? value : value.body && wireStatuses.includes(value.body.status) ? value.body : null;
    if (poll?.event) {
      // Callback bodies add an event discriminator to the PollResponse fields (§9).
      const { event, ...response } = poll; assert.equal(event, `review.${response.status}`); poll = response;
    }
    if (poll) validate('poll-response',poll,`${label}/${id}`);
    if (value.submitted_via && value.action) validate('submit-request',value,`${label}/${id}`);
    if (hitl?.context?.form) {
      const fields = hitl.context.form.fields || hitl.context.form.steps.flatMap(step => step.fields);
      const keys = fields.map(field => field.key);
      assert.equal(new Set(keys).size,keys.length,`${label}: fields must not be duplicated across wizard steps`);
      for(const field of fields) if(field.conditional) assert(keys.includes(field.conditional.field),`${label}: conditional source must be present`);
      const result = objects.find(({value}) => value.case_id === hitl.case_id && value.status === 'completed')?.value;
      if(result) assert(Object.keys(result.result.data).every(key => keys.includes(key)),`${label}: no undisclosed form field in result`);
      const progress = objects.find(({value}) => value.status === 'in_progress')?.value.progress;
      if(progress) assert(progress.current_step <= progress.total_steps && progress.completed_fields <= progress.total_fields,`${label}: coherent progress`);
    }
  }
  for(const {value} of objects) {
    const poll = wireStatuses.includes(value.status) ? value : null;
    const hitl = poll && cases.find(item => item.case_id === poll.case_id);
    if(hitl && poll.completed_at) assert(Date.parse(poll.completed_at) >= Date.parse(hitl.created_at) && Date.parse(poll.completed_at) < Date.parse(hitl.expires_at),`${label}: decision timestamp within case lifetime`);
  }
  configurations++;
}
async function configure(page,tab,choices,flags={},fields) {
  await page.evaluate(({tab,choices,flags,fields}) => {
    for(const [name,value] of Object.entries(choices)) {
      const input = [...document.getElementsByName(name)].find(option => option.value === value);
      if(!input) throw new Error(`Unknown choice ${name}/${value}`); input.checked=true;
    }
    for(const [id,checked] of Object.entries(flags)) document.getElementById(id).checked=checked;
    if(fields) fields.forEach(([id,checked])=>document.getElementById(id).checked=checked);
    switchTab(tab,false);
  },{tab,choices,flags,fields});
}
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  // Optional font requests are blocked: the local fallback must remain usable.
  await context.route(/^https?:/,route => route.request().url().startsWith(new URL(url).origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await expect(page).toHaveTitle(/v0\.9/);
  await expect(page.getByRole('tab')).toHaveCount(8);
  await check(page,'overview');
  for(const delivery of ['telegram','desktop','qr']) for(const transport of ['poll','sse','callback']) for(const scenario of ['happy','expired','cancelled']) {
    // Read actual option values below if a UI uses a shorter label.
    const options=await page.locator('input[name="uc1-scenario"]').evaluateAll(inputs=>inputs.map(input=>input.value));
    const scenarioValue=scenario==='cancelled' ? options.find(option=>!['happy','expired'].includes(option)) : scenario;
    await configure(page,1,{'uc1-delivery':delivery,'uc1-transport':transport,'uc1-scenario':scenarioValue},{'uc1-reminders':true});
    await check(page,`jobs/${delivery}/${transport}/${scenario}`);
  }
  for(const type of ['salary','visa','assessment']) {
    await configure(page,1,{'uc1-wdl-type':type},{'uc1-wdl':true}); await check(page,`WDL/${type}`);
  }
  for(const decision of ['approve','reject','changes']) for(const timeout of [false,true]) {
    await configure(page,2,{'uc2-decision':decision},{'uc2-timeout':timeout,'uc2-signed':true,'uc2-audit':true}); await check(page,`deploy/${decision}/${timeout}`);
  }
  for(const rounds of ['1','2','3']) for(const channel of ['slack','email','whatsapp']) {
    await configure(page,3,{'uc3-rounds':rounds,'uc3-channel':channel},{'uc3-sse':true,'uc3-reminders':true}); await check(page,`content/${rounds}/${channel}`);
  }
  for(const category of ['comp','data','sla']) for(const decision of ['approve','counter','reject']) for(const transport of ['poll','sse']) {
    await configure(page,4,{'uc4-category':category,'uc4-decision':decision,'uc4-transport':transport},{'uc4-signed':true,'uc4-audit':true,'uc4-dtable':true}); await check(page,`deal/${category}/${decision}/${transport}`);
  }
  const fieldIDs=['uc5-text','uc5-number','uc5-date','uc5-select','uc5-boolean','uc5-textarea'];
  for(const mode of ['single','multi']) for(let bits=0;bits<64;bits++) {
    await configure(page,5,{'uc5-mode':mode},{'uc5-sensitive':true,'uc5-conditional':true,'uc5-validation':true,'uc5-progress':true},fieldIDs.map((id,index)=>[id,Boolean(bits & (1<<index))]));
    await check(page,`form/${mode}/${bits}`);
  }
  for(let bits=0;bits<16;bits++) {
    await configure(page,5,{'uc5-mode':'multi'},Object.fromEntries(['uc5-sensitive','uc5-conditional','uc5-validation','uc5-progress'].map((id,index)=>[id,Boolean(bits & (1<<index))])),fieldIDs.map(id=>[id,true]));
    await check(page,`form/options/${bits}`);
  }
  for(const platform of ['telegram','slack','discord']) for(const action of ['confirm','cancel','details']) for(const stepUp of [false,true]) {
    await configure(page,6,{'uc7-platform':platform,'uc7-action':action},{'uc7-step-up':stepUp}); await check(page,`inline/${platform}/${action}/${stepUp}`);
    const objects=await examples(page); const decision=objects.find(({value})=>value.status==='completed')?.value;
    assert.equal(decision.status,'completed'); assert.equal(decision.result.action,action==='cancel'?'cancel':'confirm');
    assert.equal(decision.submission_context.mode,action==='details'||stepUp?'browser_submit':'inline_submit');
    if(stepUp && action!=='details') {
      const rejection=objects.find(({value})=>value.status===403)?.value;
      const hitl=objects.find(({value})=>value.spec_version)?.value;
      assert.equal(rejection.body.review_url,hitl.review_url,'Step-up must retain the original full review URL');
      assert.equal(decision.submission_context.verification_result.satisfied,true);
    }
  }
  // Native messenger controls drive the local demo, never a network request.
  await configure(page,6,{'uc7-action':'confirm'},{'uc7-step-up':false});
  await page.locator('.mock-button').filter({hasText:/^Cancel$/}).click();
  await expect(page.locator('input[name="uc7-action"][value="cancel"]')).toBeChecked();
  await expect(page.locator('#playground-status')).toContainText('No request sent');
  await page.reload(); await expect(page.locator('input[name="uc7-action"][value="cancel"]')).toBeChecked();
  await expect(page.getByRole('tab',{name:'Inline',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Inline',exact:true}).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Compare',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Home'); await expect(page.getByRole('tab',{name:'Protocol',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End'); await expect(page.getByRole('tab',{name:'Compare',exact:true})).toHaveAttribute('aria-selected','true');
  await page.goto(url+'#tab=__proto__&uc7-action=unknown');
  await expect(page.getByRole('tab',{name:'Protocol',exact:true})).toHaveAttribute('aria-selected','true');
  // Clipboard fallback excludes even nested Copy buttons.
  await configure(page,4,{'uc4-category':'comp','uc4-decision':'approve'});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
  await page.locator('#uc4-hitl .copy-btn').click();
  await expect(page.locator('#playground-status')).toContainText('JSON selected');
  const copied=await page.evaluate(()=>getSelection().toString()); validate('hitl-object',JSON.parse(copied),'clipboard fallback');
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:1000});
    for(let tab=0;tab<8;tab++) {
      await page.evaluate(tab=>switchTab(tab),tab);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow at ${width}px tab ${tab}`);
    }
  }
  assert.deepEqual(errors,[],'No JavaScript errors in any configuration');
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0,'System reduced motion suppresses animation');
  if(process.argv.includes('--capture')) {
    await page.setViewportSize({width:1440,height:1000}); await page.goto(url); await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:resolve(ROOT,'docs/playground-review/after.png')});
    await page.screenshot({path:resolve(ROOT,'assets/hitl-playground-v0.9.png')});
    await configure(page,6,{'uc7-platform':'telegram','uc7-action':'confirm'},{'uc7-step-up':true}); await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:resolve(ROOT,'docs/playground-review/after-inline.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844}); await page.screenshot({path:'/tmp/hitl-playground-mobile.png',fullPage:true});
  }
  await context.close();
  console.log(`${browserName} playground: PASS — ${configurations} configurations, ${messages} schema-valid wire messages; all 8 tabs, native buttons, step-up, URL reload, keyboard, clipboard, mobile reflow and reduced motion.`);
} finally {await browser.close(); if(server) await new Promise(done=>server.close(done));}
