(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const form = byId('quote-form');
  if (!form) return;
  const name = byId('q-name'), phone = byId('q-phone'), address = byId('q-address');
  const description = byId('q-desc'), photos = byId('q-photos'), submit = byId('q-submit');
  const error = byId('q-error'), preview = byId('q-preview'), upload = byId('q-upload-text');
  const result = byId('quote-result'), fields = byId('quote-fields');
  const api = 'https://jps-quote-worker.contact-f52.workers.dev/api/quote';
  const fallback = ' Text or call Patrick at (463) 324-9549 for help.';
  let files = [], previewUrls = [], busy = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const validPhone = () => /^(?:1)?\d{10}$/.test(phone.value.replace(/\D/g, ''));
  const valid = () => name.value.trim() && validPhone() && description.value.trim() && files.length >= 2;
  function checkForm() { submit.disabled = busy || !valid(); }
  function showError(message) {
    error.textContent = String(message).replace(/\+?1?\s*\(317\)[-\s]*794[-\s]*3067/g, '(463) 324-9549') + fallback;
    error.style.display = 'block';
  }
  function showResult(html) {
    fields.style.display = 'none';
    result.style.display = 'block';
    result.innerHTML = html;
    error.style.display = 'none';
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const options = { method: 'POST', signal: controller.signal };
      if (body instanceof FormData) options.body = body;
      else { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(body); }
      const response = await fetch(api + path, options);
      let data;
      try { data = await response.json(); }
      catch { throw new Error('The quote service returned an unreadable response.'); }
      if (!response.ok) throw new Error(data.error || 'The quote service could not complete this request.');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The request timed out; it may still have been received. Contact Patrick before submitting again.');
      throw err;
    } finally { clearTimeout(timeout); }
  }
  function renderPhotos() {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls = [];
    preview.innerHTML = '';
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
      const image = document.createElement('img');
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      image.src = url;
      image.alt = file.name;
      image.style.cssText = 'width:80px;height:80px;border-radius:10px;object-fit:cover;border:1px solid var(--line)';
      item.appendChild(image);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.addEventListener('click', () => {
        files.splice(index, 1);
        error.style.display = 'none';
        renderPhotos();
      });
      item.appendChild(remove);
      preview.appendChild(item);
    });
    upload.textContent = files.length ? `${files.length} photo(s) selected` : 'Upload 2-10 photos';
    checkForm();
  }
  photos.addEventListener('change', () => {
    if (!photos.files.length) return;
    error.style.display = 'none';
    const incoming = Array.from(photos.files);
    const merged = files.slice();
    for (const file of incoming) {
      if (!file.type.startsWith('image/')) { showError('Please select image files only.'); continue; }
      if (!merged.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) merged.push(file);
    }
    if (merged.length > 10) showError('You can upload at most 10 photos. Only the first 10 were selected.');
    files = merged.slice(0, 10);
    photos.value = '';
    renderPhotos();
  });
  [name, phone, description].forEach(input => input.addEventListener('input', checkForm));

  function showVerification(data) {
    if (!data.quoteId) throw new Error('The quote service returned an incomplete verification request.');
    showResult(`<h3>Verify Your Phone</h3><p>Enter the 6-digit code requested for the phone ending in ${escape(data.phoneLast4)}. If it does not arrive, try resending or contact Patrick.</p>
      <label for="q-otp">Verification code</label>
      <input id="q-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="display:block;width:100%;padding:12px;margin:12px 0">
      <button id="q-verify" class="btn btn-primary" type="button">Verify &amp; Get Quote</button>
      <button id="q-resend" class="btn" type="button" style="margin-top:12px">Resend code</button>
      <p id="q-verification-status" role="status"></p>`);
    const verify = byId('q-verify'), resend = byId('q-resend'), otp = byId('q-otp');
    let verifying = false, resending = false;
    async function verifyCode() {
      if (verifying) return;
      if (!/^\d{6}$/.test(otp.value.trim())) { showError('Enter the full 6-digit code.'); return; }
      verifying = true;
      verify.disabled = true;
      verify.textContent = 'Verifying...';
      error.style.display = 'none';
      try {
        const verified = await request('/verify', { quoteId: data.quoteId, otp: otp.value.trim() });
        if (verified.status !== 'quote_sent') throw new Error('The quote is not ready yet.');
        showQuote(verified);
      } catch (err) { showError(err.message); }
      finally { verifying = false; verify.disabled = false; verify.textContent = 'Verify & Get Quote'; }
    }
    verify.addEventListener('click', verifyCode);
    otp.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); verifyCode(); } });
    resend.addEventListener('click', async () => {
      if (resending) return;
      resending = true;
      resend.disabled = true;
      try {
        const sent = await request('/verify/send', { quoteId: data.quoteId });
        if (sent.status !== 'sent') throw new Error(sent.error || 'The code could not be resent.');
        byId('q-verification-status').textContent = 'A new code was requested. Please wait 30 seconds before requesting another.';
        setTimeout(() => { resending = false; resend.disabled = false; }, 30000);
      } catch (err) { showError(err.message); resending = false; resend.disabled = false; }
    });
  }
  function showQuote(data) {
    if (data.status !== 'quote_sent' || !data.quoteId || data.total == null || !Number.isFinite(Number(data.total)) || Number(data.total) < 0) {
      throw new Error('The quote service returned an incomplete estimate.');
    }
    const items = Array.isArray(data.details?.line_items) ? data.details.line_items : [];
    showResult(`<h3>Your Quote: $${escape(data.total)}</h3>
      <div style="margin:12px auto">${items.map(item => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${escape(item.item)}</span><span>$${escape(item.price)}</span></div>`).join('')}</div>
      <p>${escape(data.checkerNote || data.packageNote || '')}</p>
      ${data.scopeUncertainty ? '<p>Scope may change if there are unseen areas or additional items.</p>' : ''}
      <fieldset style="border:0;margin:16px 0"><legend>How will you pay?</legend>
      <label><input type="radio" name="q-payment" value="cash" checked> Cash</label>
      <label><input type="radio" name="q-payment" value="check"> Check</label></fieldset>
      <details style="text-align:left;margin:16px 0"><summary>Cancellation Policy</summary>
      <p>Cancellations before the scheduled service date, after arrival, or after work has started are subject to 30% of the original approved quote total, with a $50 minimum. If documented labor, fuel, disposal, equipment, or travel costs exceed that fee, the actual costs apply.</p></details>
      <label style="display:block;text-align:left;margin:12px 0"><input id="q-policy-agree" type="checkbox"> I have read and agree to the cancellation policy.</label>
      <button id="q-accept" class="btn btn-primary" type="button" disabled>Accept Quote &amp; Text Patrick</button>`);
    const consent = byId('q-policy-agree'), accept = byId('q-accept');
    let accepting = false;
    consent.addEventListener('change', () => { accept.disabled = accepting || !consent.checked; });
    accept.addEventListener('click', async () => {
      if (accepting || !consent.checked) return;
      accepting = true;
      accept.disabled = true;
      accept.textContent = 'Confirming...';
      error.style.display = 'none';
      try {
        const payment = document.querySelector('input[name="q-payment"]:checked');
        if (!payment) throw new Error('Select a payment method.');
        const confirmed = await request('/confirm', { quoteId: data.quoteId, payment_method: payment.value, policy_agreed: true, device_info: navigator.userAgent });
        if (confirmed.status !== 'accepted') throw new Error(confirmed.error || 'The quote was not accepted.');
        const sms = `Hi Patrick, I want to go ahead with the quote. Name: ${confirmed.name || name.value.trim()}, Address: ${confirmed.address || address.value.trim()}, Total: $${confirmed.total ?? data.total}, Pay: ${confirmed.payment_method || payment.value}`;
        showResult(`<h3>Quote Accepted</h3><p>Text or call Patrick to confirm your appointment.</p>
          <a class="btn btn-primary" href="sms:+14633249549?body=${escape(encodeURIComponent(sms))}" style="margin:12px 0">Text Patrick Now</a>
          <a class="btn" href="tel:+14633249549">Call Patrick: (463) 324-9549</a>`);
      } catch (err) { showError(err.message); }
      finally { accepting = false; accept.disabled = !consent.checked; accept.textContent = 'Accept Quote & Text Patrick'; }
    });
  }
  submit.addEventListener('click', async () => {
    if (busy || !valid()) return;
    busy = true;
    checkForm();
    submit.textContent = 'Calculating...';
    error.style.display = 'none';
    const body = new FormData();
    body.append('name', name.value.trim());
    body.append('phone', phone.value.trim());
    body.append('address', address.value.trim());
    body.append('description', description.value.trim());
    files.forEach(file => body.append('photos', file));
    try {
      const data = await request('', body);
      if (data.status === 'pending_verification') showVerification(data);
      else if (data.status === 'pending_review') showResult('<h3>Quote Under Review</h3><p>Patrick will review your request and contact you before work starts.</p>');
      else showQuote(data);
    } catch (err) { showError(err.message); }
    finally { busy = false; submit.textContent = 'Get Instant Quote'; checkForm(); }
  });
  checkForm();
})();
