import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../assets/quote-form.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function setup(responses = []) {
  const elements = new Map(), calls = [], revoked = [];
  class Element {
    constructor() { this.value = ''; this.style = {}; this.listeners = {}; this.children = []; this.disabled = false; this.checked = false; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this[name] = value; }
    set innerHTML(value) {
      this.markup = value;
      this.children = [];
      for (const match of value.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
      if (value.includes('id="q-accept"')) elements.get('q-accept').disabled = true;
    }
    get innerHTML() { return this.markup || ''; }
    async emit(event) { return this.listeners[event]?.({ preventDefault() {}, key: 'Enter' }); }
  }
  const ids = ['quote-form','q-name','q-phone','q-address','q-desc','q-photos','q-submit','q-error','q-preview','q-upload-text','quote-result','quote-fields'];
  ids.forEach(id => elements.set(id, new Element()));
  const get = id => elements.get(id);
  const context = {
    document: { getElementById: get, createElement: () => new Element(), querySelector: () => ({ value: 'cash' }) },
    navigator: { userAgent: 'test-browser' },
    FormData: class { constructor() { this.values = []; } append(...args) { this.values.push(args); } },
    AbortController,
    setTimeout: () => 1, clearTimeout() {},
    URL: { createObjectURL: file => 'blob:' + file.name, revokeObjectURL: url => revoked.push(url) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'Unexpected network request');
      return { ok: response.ok !== false, json: async () => { if (response.invalidJson) throw new Error('JSON'); return response.data; } };
    }
  };
  vm.runInNewContext(script, context);
  const photo = n => ({ name: `${n}.jpg`, type: 'image/jpeg', size: n, lastModified: n });
  async function choose(files) { get('q-photos').files = files; await get('q-photos').emit('change'); }
  async function ready() {
    get('q-name').value = 'Test Customer'; get('q-phone').value = '(463) 555-0100'; get('q-desc').value = 'Sofa and chairs';
    await choose([photo(1), photo(2)]);
  }
  return { get, calls, choose, photo, ready, revoked };
}
const quote = { quoteId: 'test-quote', status: 'quote_sent', total: 150, details: { line_items: [{ item: 'Sofa', price: 150 }] } };
test('pending verification renders OTP instead of an undefined quote; six numeric digits reach the API', async () => {
  const app = setup([{ data: { quoteId: 'test-quote', status: 'pending_verification', phoneLast4: '0100' } }, { data: quote }]);
  await app.ready(); await app.get('q-submit').emit('click');
  assert.match(app.get('quote-result').innerHTML, /Verify Your Phone/);
  assert.doesNotMatch(app.get('quote-result').innerHTML, /undefined/);
  app.get('q-otp').value = '123456'; await app.get('q-verify').emit('click');
  assert.match(app.calls[1].url, /\/verify$/);
  assert.equal(JSON.parse(app.calls[1].options.body).otp, '123456');
  assert.match(app.get('quote-result').innerHTML, /Your Quote: \$150/);
});
test('acceptance requires consent and sends the API policy flag', async () => {
  const app = setup([{ data: quote }, { data: { status: 'accepted', total: 150 } }]);
  await app.ready(); await app.get('q-submit').emit('click');
  assert.equal(app.get('q-accept').disabled, true);
  await app.get('q-accept').emit('click'); assert.equal(app.calls.length, 1);
  app.get('q-policy-agree').checked = true; await app.get('q-policy-agree').emit('change');
  await app.get('q-accept').emit('click');
  assert.equal(JSON.parse(app.calls[1].options.body).policy_agreed, true);
  assert.match(app.get('quote-result').innerHTML, /Quote Accepted/);
  assert.match(app.get('quote-result').innerHTML, /sms:\+14633249549/);
});
test('confirmation HTTP errors remain visible and allow retry', async () => {
  const app = setup([{ data: quote }, { ok: false, data: { status: 'accepted', error: 'Service unavailable' } }]);
  await app.ready(); await app.get('q-submit').emit('click');
  app.get('q-policy-agree').checked = true; await app.get('q-accept').emit('click');
  assert.equal(app.get('q-error').style.display, 'block');
  assert.match(app.get('q-error').textContent, /Service unavailable/);
  assert.equal(app.get('q-accept').disabled, false);
  assert.doesNotMatch(app.get('quote-result').innerHTML, /Quote Accepted/);
});
test('API-controlled quote text is escaped before HTML rendering', async () => {
  const malicious = { ...quote, total: 99, checkerNote: '<img src=x onerror=alert(1)>', details: { line_items: [{ item: '<script>alert(1)</script>', price: '<b>99</b>' }] } };
  const app = setup([{ data: malicious }]); await app.ready(); await app.get('q-submit').emit('click');
  const rendered = app.get('quote-result').innerHTML;
  assert.match(rendered, /&lt;script&gt;/); assert.match(rendered, /&lt;img/);
  assert.doesNotMatch(rendered, /<script|<img/);
});
test('unknown statuses and missing totals never render an actionable quote', async () => {
  for (const data of [{ quoteId: 'x', status: 'unexpected' }, { quoteId: 'x', status: 'quote_sent' }, { ...quote, total: '<script>' }]) {
    const app = setup([{ data }]); await app.ready(); await app.get('q-submit').emit('click');
    assert.match(app.get('q-error').textContent, /incomplete estimate/);
    assert.equal(app.get('quote-result').style.display, undefined);
  }
});
test('photo selections accumulate and duplicates are ignored; obsolete previews are released', async () => {
  const app = setup(); await app.choose([app.photo(1)]); await app.choose([app.photo(1), app.photo(2)]);
  assert.equal(app.get('q-upload-text').textContent, '2 photo(s) selected');
  assert.deepEqual(app.revoked, ['blob:1.jpg']);
});
test('each photo can be removed and the minimum photo requirement is enforced again', async () => {
  const app = setup(); await app.ready();
  assert.equal(app.get('q-submit').disabled, false);
  const firstPhoto = app.get('q-preview').children[0];
  assert.equal(firstPhoto.children[1]['aria-label'], 'Remove 1.jpg');
  await firstPhoto.children[1].emit('click');
  assert.equal(app.get('q-upload-text').textContent, '1 photo(s) selected');
  assert.equal(app.get('q-submit').disabled, true);
  assert.equal(app.get('q-preview').children[0].children[1]['aria-label'], 'Remove 2.jpg');
});
test('nonimages are rejected and selections are capped at ten', async () => {
  const app = setup(); await app.choose([{ name: 'bad.txt', type: 'text/plain' }]);
  assert.match(app.get('q-error').textContent, /image files only/);
  await app.choose(Array.from({ length: 11 }, (_, i) => app.photo(i)));
  assert.equal(app.get('q-preview').children.length, 10);
  assert.match(app.get('q-error').textContent, /at most 10/);
});
test('invalid phone numbers keep submission disabled', async () => {
  const app = setup(); await app.ready(); app.get('q-phone').value = 'abc'; await app.get('q-phone').emit('input');
  assert.equal(app.get('q-submit').disabled, true); await app.get('q-submit').emit('click'); assert.equal(app.calls.length, 0);
});
test('invalid OTP does not send a verification request', async () => {
  const app = setup([{ data: { status: 'pending_verification', quoteId: 'x' } }]);
  await app.ready(); await app.get('q-submit').emit('click'); app.get('q-otp').value = 'abcdef'; await app.get('q-verify').emit('click');
  assert.equal(app.calls.length, 1); assert.match(app.get('q-error').textContent, /6-digit code/);
});
test('unreadable service responses show fallback contact and restore submission', async () => {
  const app = setup([{ invalidJson: true }]); await app.ready(); await app.get('q-submit').emit('click');
  assert.match(app.get('q-error').textContent, /unreadable response.*463/); assert.equal(app.get('q-submit').disabled, false);
});
test('manual-review response does not display a price', async () => {
  const app = setup([{ data: { status: 'pending_review' } }]); await app.ready(); await app.get('q-submit').emit('click');
  assert.match(app.get('quote-result').innerHTML, /Under Review/); assert.doesNotMatch(app.get('quote-result').innerHTML, /undefined|Your Quote:/);
});
test('error message sits outside the hidden input section and inputs have accessible names', () => {
  assert.match(html, /<\/div>\s*<div id="q-error" role="alert"/);
  for (const id of ['q-name','q-phone','q-address','q-desc']) assert.match(html, new RegExp(`id="${id}" aria-label=`));
  assert.match(html, /<noscript>/); assert.doesNotMatch(html, /PLACEHOLDER_CID/);
  assert.match(html, /id="q-photos"[^>]*aria-describedby="q-requirements"/);
  assert.doesNotMatch(html, /id="q-photos"[^>]*display\s*:\s*none/);
});
test('outdated backend contact number is replaced by the current site contact', async () => {
  const app = setup([{ ok: false, data: { error: 'Text Patrick at +1(317)-794-3067 to verify.' } }]);
  await app.ready(); await app.get('q-submit').emit('click');
  assert.doesNotMatch(app.get('q-error').textContent, /317/);
  assert.match(app.get('q-error').textContent, /\(463\) 324-9549/);
});
