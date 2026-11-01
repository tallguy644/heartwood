(function () {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const STATUS = { 'available': 'Available', 'made-to-order': 'Made to order', 'sold': 'Sold', 'hidden': 'Hidden' };
  const STORE_KEY = 'tilley-admin-v2';
  const API = String(window.TW_API || '').replace(/\/+$/, '');

  const DEFAULT_DATA = {
    settings: { storeName: 'Tilley Woodworks', tagline: '', heroEyebrow: '', heroHeading: '', heroText: '', heroImage: '', aboutHeading: '', aboutText: '', contactEmail: '', contactPhone: '', customOrdersText: '' },
    categories: [],
    items: []
  };

  // ---------- state ----------
  let session = null;          // { token, user: { email, name, role } }
  let data = null;             // working inventory
  let published = '';          // JSON of last published inventory
  let version = 0;             // server version the working copy is based on
  const pending = new Map();   // temp path -> base64 JPEG (new photos not yet uploaded)
  const previews = new Map();  // temp path -> data URL
  let draft = null;            // piece being edited
  let draftIsNew = false;
  let busy = false;

  // ---------- storage ----------
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* private mode: stays for this visit */ }
  }
  function clearSession() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- backend ----------
  async function api(path, opts) {
    opts = opts || {};
    const headers = {};
    if (session && session.token) headers['Authorization'] = 'Bearer ' + session.token;
    let body = opts.body;
    if (body && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    if (body instanceof Blob) headers['Content-Type'] = 'image/jpeg';
    const r = await fetch(API + path, { method: opts.method || 'GET', headers, body, cache: 'no-store' });
    let out = null;
    try { out = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) {
      const err = new Error((out && out.error) || r.statusText || 'Request failed');
      err.status = r.status;
      err.body = out;
      throw err;
    }
    out = out || {};
    out._version = r.headers.get('X-Version');
    return out;
  }

  function friendlyError(e) {
    if (e instanceof TypeError) return 'Couldn\'t reach the inventory server. Check your internet connection and try again.';
    return e.message || 'Something went wrong.';
  }

  // ---------- status bar ----------
  let statusTimer = null;
  function setStatus(html, kind, sticky) {
    const bar = $('#statusbar');
    bar.innerHTML = html;
    bar.className = 'statusbar' + (kind ? ' statusbar--' + kind : '');
    bar.hidden = false;
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(() => { bar.hidden = true; }, 6000);
  }

  // ---------- sign in ----------
  async function loadInventory() {
    const r = await api('/api/inventory');
    version = Number(r._version) || 0;
    delete r._version;
    data = r;
    data.settings = Object.assign({}, DEFAULT_DATA.settings, data.settings || {});
    data.categories = data.categories || [];
    data.items = data.items || [];
    published = JSON.stringify(data);
  }

  function showScreen(which, msg) {
    $('#connect').hidden = false;
    $('#app').hidden = true;
    $('#no-backend').hidden = which !== 'none';
    $('#setup-form').hidden = which !== 'setup';
    $('#login-form').hidden = which !== 'login';
    $('#connect-msg').textContent = msg || '';
  }

  async function signedIn(s) {
    session = s;
    saveSession(s);
    await loadInventory();
    showApp();
  }

  async function submitForm(form, fn) {
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    $('#connect-msg').textContent = 'One moment…';
    try { await fn(); }
    catch (err) { $('#connect-msg').textContent = friendlyError(err); }
    finally { btn.disabled = false; }
  }

  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      const r = await api('/api/setup', { method: 'POST', body: { code: $('#u-code').value, name: $('#u-name').value, email: $('#u-email').value, password: $('#u-pass').value } });
      await signedIn({ token: r.token, user: r.user });
    });
  });

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      const r = await api('/api/login', { method: 'POST', body: { email: $('#l-email').value, password: $('#l-pass').value } });
      await signedIn({ token: r.token, user: r.user });
    });
  });

  async function boot() {
    if (!API) { showScreen('none'); return; }
    const saved = loadSession();
    if (saved && saved.token) {
      session = saved;
      try {
        session.user = await api('/api/me');
        delete session.user._version;
        saveSession(session);
        await loadInventory();
        showApp();
        return;
      } catch (err) {
        session = null;
        clearSession();
        if (!(err.status === 401)) { showScreen('login', friendlyError(err)); return; }
      }
    }
    try {
      const st = await api('/api/status');
      showScreen(st.needsSetup ? 'setup' : 'login');
    } catch (err) {
      showScreen('login', friendlyError(err));
    }
  }

  function showApp() {
    $('#connect').hidden = true;
    $('#app').hidden = false;
    $('#view-live').href = 'https://tilleywoodworks.com/';
    const owner = session.user.role === 'owner';
    $('#staff-tab').hidden = !owner;
    $('#me-email').textContent = session.user.email;
    $('#me-role').textContent = owner ? '(owner)' : '(staff)';
    $('#import-box').hidden = !(owner && version === 0);
    renderAll();
    if (owner) loadUsers();
  }

  $('#disconnect').addEventListener('click', async () => {
    if (isDirty() && !armed($('#disconnect'), 'Unpublished changes will be lost. Tap again')) return;
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* signing out locally anyway */ }
    clearSession();
    location.reload();
  });

  // Signed out by the server (expired, or removed by the owner)?
  function handleAuthError(err) {
    if (err.status !== 401) return false;
    clearSession();
    session = null;
    showScreen('login', err.message);
    return true;
  }

  // ---------- two-tap confirm ----------
  function armed(btn, label) {
    if (btn.dataset.armed === 'true') { btn.dataset.armed = 'false'; btn.textContent = btn.dataset.label; return true; }
    btn.dataset.label = btn.textContent;
    btn.dataset.armed = 'true';
    btn.textContent = label;
    setTimeout(() => { if (btn.dataset.armed === 'true') { btn.dataset.armed = 'false'; btn.textContent = btn.dataset.label; } }, 4000);
    return false;
  }

  // ---------- dirty tracking ----------
  function isDirty() { return data && JSON.stringify(data) !== published; }

  function changeCount() {
    if (!isDirty()) return 0;
    const before = JSON.parse(published);
    let n = 0;
    const map = new Map(before.items.map((i) => [i.id, JSON.stringify(i)]));
    data.items.forEach((i) => { if (map.get(i.id) !== JSON.stringify(i)) n++; map.delete(i.id); });
    n += map.size;
    if (JSON.stringify(before.categories) !== JSON.stringify(data.categories)) n++;
    if (JSON.stringify(before.settings) !== JSON.stringify(data.settings)) n++;
    return n;
  }

  function itemDirty(item) {
    const before = JSON.parse(published).items.find((i) => i.id === item.id);
    return !before || JSON.stringify(before) !== JSON.stringify(item);
  }

  function updatePublishButton() {
    const n = changeCount();
    const btn = $('#publish-btn');
    btn.disabled = busy || n === 0;
    btn.textContent = busy ? 'Publishing…' : (n ? 'Publish ' + n + (n === 1 ? ' change' : ' changes') : 'Published');
  }

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- images ----------
  function imageRefs(d) {
    d = d || data;
    const out = new Set();
    d.items.forEach((i) => (i.images || []).forEach((p) => out.add(p)));
    if (d.settings.heroImage) out.add(d.settings.heroImage);
    return out;
  }
  // Uploaded photos live on the server ("img/…"); the original photos ship with the site.
  const imgSrc = (p) => previews.get(p) || (/^img\//.test(p) ? API + '/' + p : p);

  function loadImageEl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  async function processImage(file, baseName) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { src = await loadImageEl(file); }
    const w0 = src.width, h0 = src.height;
    const scale = Math.min(1, 1800 / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(src, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const path = 'pending/' + (slug(baseName) || 'photo') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg';
    pending.set(path, dataUrl.split(',')[1]);
    previews.set(path, dataUrl);
    return path;
  }

  function b64ToBlob(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  // Swap every temp/old photo path in the inventory for its new server path.
  function replacePaths(map) {
    data.items.forEach((i) => { i.images = (i.images || []).map((p) => map.get(p) || p); });
    if (map.has(data.settings.heroImage)) data.settings.heroImage = map.get(data.settings.heroImage);
    if (draft) draft.images = (draft.images || []).map((p) => map.get(p) || p);
  }

  // ---------- tabs ----------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));

  // ---------- render ----------
  function renderAll() {
    $('#tb-store').textContent = data.settings.storeName || 'Your store';
    renderPieces();
    renderCategories();
    renderSettings();
    updatePublishButton();
  }

  const catName = (id) => { const c = data.categories.find((c) => c.id === id); return c ? c.name : 'No category'; };

  function renderPieces() {
    const q = $('#q').value.trim().toLowerCase();
    const st = $('#fstatus').value;
    const list = data.items
      .filter((i) => !st || i.status === st)
      .filter((i) => !q || [i.name, i.wood, catName(i.categoryId), i.description].join(' ').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.name.localeCompare(b.name));

    const counts = { available: 0, 'made-to-order': 0, sold: 0, hidden: 0 };
    let value = 0;
    data.items.forEach((i) => {
      counts[i.status] = (counts[i.status] || 0) + 1;
      if (i.status === 'available' && i.price != null && i.price !== '') value += Number(i.price) * (Number(i.quantity) || 1);
    });
    $('#summary').innerHTML =
      '<span><strong>' + data.items.length + '</strong> pieces</span>' +
      '<span><strong>' + counts.available + '</strong> available</span>' +
      '<span><strong>' + counts['made-to-order'] + '</strong> made to order</span>' +
      '<span><strong>' + counts.sold + '</strong> sold</span>' +
      (counts.hidden ? '<span><strong>' + counts.hidden + '</strong> hidden</span>' : '') +
      (value ? '<span>Listed value <strong>' + money.format(value) + '</strong></span>' : '');

    if (!data.items.length) {
      $('#plist').innerHTML = '<li class="muted">No pieces yet. Tap "+ Add piece" to list your first one.</li>';
      return;
    }
    if (!list.length) {
      $('#plist').innerHTML = '<li class="muted">No pieces match that search.</li>';
      return;
    }
    $('#plist').innerHTML = list.map((i) => {
      const thumb = i.images && i.images[0] ? '<img class="pitem__thumb" src="' + esc(imgSrc(i.images[0])) + '" alt="">' : '<div class="pitem__thumb"></div>';
      const price = i.price == null || i.price === '' ? 'Ask for price' : money.format(Number(i.price));
      const qty = i.status === 'available' && i.quantity != null && i.quantity !== '' ? ' · Qty ' + i.quantity : '';
      const dirty = itemDirty(i);
      const quick = i.status === 'sold'
        ? '<button type="button" class="mini" data-quick="available" data-id="' + esc(i.id) + '">Mark available</button>'
        : (i.status === 'hidden' ? '<button type="button" class="mini" data-quick="available" data-id="' + esc(i.id) + '">Show on site</button>'
          : '<button type="button" class="mini" data-quick="sold" data-id="' + esc(i.id) + '">Mark sold</button>');
      return '<li class="pitem' + (dirty ? ' pitem--dirty' : '') + '">' + thumb +
        '<button type="button" class="pitem__main" data-edit="' + esc(i.id) + '">' +
          '<span class="pitem__name">' + esc(i.name) + '</span>' +
          '<span class="pitem__meta">' + esc(catName(i.categoryId)) + ' · ' + esc(price) + esc(qty) + '</span>' +
          (dirty ? '<span class="unsaved">Not published yet</span>' : '') +
        '</button>' +
        '<div class="pitem__side"><span class="pill pill--' + esc(i.status) + '">' + STATUS[i.status] + '</span>' + quick + '</div>' +
      '</li>';
    }).join('');
  }

  $('#add-piece').addEventListener('click', () => openEditor(null));
  $('#q').addEventListener('input', renderPieces);
  $('#fstatus').addEventListener('change', renderPieces);

  $('#plist').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) { openEditor(edit.dataset.edit); return; }
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const item = data.items.find((i) => i.id === quick.dataset.id);
      item.status = quick.dataset.quick;
      if (item.status === 'sold' && Number(item.quantity) > 0) item.quantity = Math.max(0, Number(item.quantity) - 1);
      renderPieces();
      updatePublishButton();
    }
  });

  // ---------- categories ----------
  function renderCategories() {
    const list = $('#clist');
    if (!data.categories.length) {
      list.innerHTML = '<li class="muted">No categories yet.</li>';
      return;
    }
    list.innerHTML = data.categories.map((c, n) => {
      const count = data.items.filter((i) => i.categoryId === c.id).length;
      return '<li class="citem">' +
        '<div class="field"><label class="visually-hidden" for="cat-' + n + '">Category name</label><input id="cat-' + n + '" type="text" value="' + esc(c.name) + '" data-cat-rename="' + esc(c.id) + '"></div>' +
        '<span class="citem__count">' + count + (count === 1 ? ' piece' : ' pieces') + '</span>' +
        '<button type="button" class="btn btn--danger" data-cat-delete="' + esc(c.id) + '">Delete</button>' +
      '</li>';
    }).join('');
  }

  $('#clist').addEventListener('input', (e) => {
    const id = e.target.dataset.catRename;
    if (!id) return;
    const c = data.categories.find((c) => c.id === id);
    c.name = e.target.value;
    updatePublishButton();
  });
  $('#clist').addEventListener('change', (e) => {
    if (e.target.dataset.catRename && !e.target.value.trim()) {
      const c = data.categories.find((c) => c.id === e.target.dataset.catRename);
      c.name = 'Untitled';
      e.target.value = c.name;
    }
    renderPieces();
  });
  $('#clist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-delete]');
    if (!b) return;
    const id = b.dataset.catDelete;
    const count = data.items.filter((i) => i.categoryId === id).length;
    if (!armed(b, count ? 'Tap again (' + count + ' → no category)' : 'Tap again to delete')) return;
    data.categories = data.categories.filter((c) => c.id !== id);
    data.items.forEach((i) => { if (i.categoryId === id) i.categoryId = ''; });
    renderCategories();
    renderPieces();
    updatePublishButton();
  });

  function addCategory(name) {
    name = name.trim();
    if (!name) return null;
    const existing = data.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    let id = slug(name) || 'category';
    let n = 2;
    while (data.categories.some((c) => c.id === id)) id = slug(name) + '-' + n++;
    data.categories.push({ id, name });
    return id;
  }

  $('#cat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addCategory($('#new-cat').value);
    $('#new-cat').value = '';
    renderCategories();
    updatePublishButton();
  });

  // ---------- settings ----------
  function renderSettings() {
    $$('[data-setting]').forEach((el) => { el.value = data.settings[el.dataset.setting] || ''; });
    const hp = $('#hero-preview');
    if (data.settings.heroImage) { hp.src = imgSrc(data.settings.heroImage); hp.hidden = false; } else { hp.hidden = true; }
  }

  $('#settings-form').addEventListener('input', (e) => {
    const k = e.target.dataset.setting;
    if (!k) return;
    data.settings[k] = e.target.value;
    if (k === 'storeName') $('#tb-store').textContent = e.target.value || 'Your store';
    updatePublishButton();
  });
  $('#settings-form').addEventListener('submit', (e) => e.preventDefault());

  $('#s-heroFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      data.settings.heroImage = await processImage(f, 'hero');
      renderSettings();
      updatePublishButton();
    } catch (err) {
      setStatus('Couldn\'t read that photo. Try a JPG or PNG.', 'err');
    }
  });

  // ---------- piece editor ----------
  const editor = $('#editor');

  function fillCategorySelect(selected) {
    $('#p-cat').innerHTML = '<option value="">No category</option>' +
      data.categories.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') +
      '<option value="__new">+ New category…</option>';
    $('#p-cat').value = selected || '';
  }

  $('#p-cat').addEventListener('change', (e) => {
    if (e.target.value !== '__new') return;
    const wrap = e.target.closest('.field');
    if (wrap.querySelector('#p-newcat')) { wrap.querySelector('#p-newcat').focus(); return; }
    const input = document.createElement('input');
    input.type = 'text'; input.id = 'p-newcat'; input.placeholder = 'New category name';
    input.setAttribute('aria-label', 'New category name');
    wrap.appendChild(input);
    input.focus();
  });

  function openEditor(id) {
    draftIsNew = !id;
    const base = id ? data.items.find((i) => i.id === id) : {
      id: '', name: '', categoryId: data.categories[0] ? data.categories[0].id : '', status: 'available',
      price: null, quantity: 1, featured: false, oneOfAKind: true, wood: '', dimensions: '', finish: '',
      description: '', images: [], createdAt: new Date().toISOString().slice(0, 10)
    };
    draft = JSON.parse(JSON.stringify(base));
    $('#ed-title').textContent = draftIsNew ? 'Add a piece' : 'Edit piece';
    $('#p-name').value = draft.name;
    fillCategorySelect(draft.categoryId);
    const nc = $('#p-newcat'); if (nc) nc.remove();
    $('#p-status').value = draft.status;
    $('#p-price').value = draft.price == null ? '' : draft.price;
    $('#p-qty').value = draft.quantity == null ? '' : draft.quantity;
    $('#p-featured').checked = !!draft.featured;
    $('#p-ooak').checked = !!draft.oneOfAKind;
    $('#p-wood').value = draft.wood || '';
    $('#p-finish').value = draft.finish || '';
    $('#p-dims').value = draft.dimensions || '';
    $('#p-desc').value = draft.description || '';
    $('#p-delete').hidden = draftIsNew;
    $('#p-delete').dataset.armed = 'false';
    $('#p-delete').textContent = 'Delete';
    renderPhotos();
    editor.showModal();
    if (draftIsNew) $('#p-name').focus();
  }

  function renderPhotos(busyText) {
    const imgs = draft.images;
    $('#p-photos').innerHTML = imgs.map((p, n) =>
      '<li class="photo"><img src="' + esc(imgSrc(p)) + '" alt="Photo ' + (n + 1) + '">' +
        (n === 0 ? '<span class="photo__cover">Cover</span>' : '') +
        '<div class="photo__tools">' +
          (n > 0 ? '<button type="button" data-cover="' + n + '">Make cover</button>' : '<span></span>') +
          '<button type="button" data-remove="' + n + '" aria-label="Remove photo ' + (n + 1) + '">Remove</button>' +
        '</div></li>'
    ).join('') + (busyText ? '<li class="photos__busy">' + esc(busyText) + '</li>' : '');
  }

  $('#p-photos').addEventListener('click', (e) => {
    const cover = e.target.closest('[data-cover]');
    const rm = e.target.closest('[data-remove]');
    if (cover) {
      const n = Number(cover.dataset.cover);
      const [p] = draft.images.splice(n, 1);
      draft.images.unshift(p);
      renderPhotos();
    } else if (rm) {
      draft.images.splice(Number(rm.dataset.remove), 1);
      renderPhotos();
    }
  });

  $('#p-files').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    let failed = 0;
    for (let k = 0; k < files.length; k++) {
      renderPhotos('Preparing photo ' + (k + 1) + ' of ' + files.length + '…');
      try { draft.images.push(await processImage(files[k], $('#p-name').value || 'piece')); }
      catch (err) { failed++; }
    }
    renderPhotos();
    if (failed) setStatus(failed + (failed === 1 ? ' photo' : ' photos') + ' couldn\'t be read. Try JPG or PNG.', 'err');
  });

  $$('[data-cancel]').forEach((b) => b.addEventListener('click', () => editor.close()));

  $('#piece-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#p-name').value.trim();
    if (!name) { $('#p-name').focus(); return; }

    let cat = $('#p-cat').value;
    if (cat === '__new') {
      const nc = $('#p-newcat');
      cat = nc && nc.value.trim() ? addCategory(nc.value) : '';
    }

    const priceRaw = $('#p-price').value.trim();
    const qtyRaw = $('#p-qty').value.trim();
    Object.assign(draft, {
      name,
      categoryId: cat,
      status: $('#p-status').value,
      price: priceRaw === '' ? null : Math.round(Number(priceRaw) * 100) / 100,
      quantity: qtyRaw === '' ? null : Math.max(0, parseInt(qtyRaw, 10) || 0),
      featured: $('#p-featured').checked,
      oneOfAKind: $('#p-ooak').checked,
      wood: $('#p-wood').value.trim(),
      finish: $('#p-finish').value.trim(),
      dimensions: $('#p-dims').value.trim(),
      description: $('#p-desc').value.trim()
    });

    if (draftIsNew) {
      let id = slug(name) || 'piece';
      let n = 2;
      while (data.items.some((i) => i.id === id)) id = (slug(name) || 'piece') + '-' + n++;
      draft.id = id;
      data.items.push(draft);
    } else {
      const idx = data.items.findIndex((i) => i.id === draft.id);
      data.items[idx] = draft;
    }
    editor.close();
    renderAll();
    setStatus('Saved "' + esc(name) + '". Tap Publish to put it on your site.');
  });

  $('#p-delete').addEventListener('click', (e) => {
    if (!armed(e.currentTarget, 'Tap again to delete')) return;
    data.items = data.items.filter((i) => i.id !== draft.id);
    editor.close();
    renderAll();
    setStatus('Deleted. Tap Publish to remove it from your site.');
  });

  // ---------- publish ----------
  $('#publish-btn').addEventListener('click', publish);

  async function uploadPending() {
    const map = new Map();
    const refs = [...imageRefs()].filter((p) => pending.has(p));
    for (let k = 0; k < refs.length; k++) {
      const p = refs[k];
      setStatus('Uploading photo ' + (k + 1) + ' of ' + refs.length + '…', null, true);
      const base = p.replace(/^pending\//, '').replace(/-[a-z0-9]+\.jpg$/, '');
      const r = await api('/api/images?name=' + encodeURIComponent(base), { method: 'POST', body: b64ToBlob(pending.get(p)) });
      map.set(p, r.path);
      previews.set(r.path, previews.get(p));
      pending.delete(p);
    }
    if (map.size) replacePaths(map);
  }

  async function publish() {
    if (busy || !isDirty()) return;
    busy = true;
    updatePublishButton();
    setStatus('Publishing to your site…', null, true);
    try {
      await uploadPending();
      const n = changeCount();
      const r = await api('/api/inventory', { method: 'PUT', body: { baseVersion: version, data } });
      version = r.version;
      published = JSON.stringify(data);
      busy = false;
      $('#import-box').hidden = true;
      renderAll();
      setStatus('Published ' + n + (n === 1 ? ' change' : ' changes') + '. Your site shows them within a minute. <a href="' + esc($('#view-live').href) + '" target="_blank" rel="noopener">View site ↗</a>', 'ok', true);
    } catch (err) {
      busy = false;
      updatePublishButton();
      if (handleAuthError(err)) return;
      if (err.status === 409) {
        setStatus(esc(err.message) + ' <button type="button" class="mini" id="reload-now">Reload now</button>', 'err', true);
        const b = $('#reload-now');
        if (b) b.addEventListener('click', () => { published = JSON.stringify(data); location.reload(); });
        return;
      }
      setStatus(esc(friendlyError(err)) + ' Your changes are still here.', 'err', true);
    }
  }

  // ---------- staff (owner) ----------
  let users = [];
  async function loadUsers() {
    try {
      users = (await api('/api/users')).users || [];
      renderUsers();
    } catch (err) {
      if (!handleAuthError(err)) $('#ulist').innerHTML = '<li class="muted">' + esc(friendlyError(err)) + '</li>';
    }
  }

  function renderUsers() {
    $('#ulist').innerHTML = users.map((u) =>
      '<li class="uitem">' +
        '<div class="uitem__who"><strong>' + esc(u.name || u.email) + '</strong><span>' + esc(u.email) + '</span></div>' +
        '<span class="pill">' + (u.role === 'owner' ? 'Owner' : 'Staff') + '</span>' +
        (u.role === 'owner' ? '<span></span>' : '<button type="button" class="btn btn--danger" data-user-remove="' + esc(u.email) + '">Remove</button>') +
      '</li>'
    ).join('') || '<li class="muted">No one yet.</li>';
  }

  $('#n-email').addEventListener('input', () => {
    const known = users.some((u) => u.email === $('#n-email').value.trim().toLowerCase());
    $('#user-submit').textContent = known ? 'Set new password' : 'Add helper';
    $('#user-form-title').textContent = known ? 'Reset a password' : 'Add a helper';
  });

  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#user-submit');
    btn.disabled = true;
    try {
      const body = { email: $('#n-email').value, password: $('#n-pass').value };
      if ($('#n-name').value.trim()) body.name = $('#n-name').value.trim();
      const r = await api('/api/users', { method: 'POST', body });
      setStatus(r.created ? esc(r.user.email) + ' can now sign in at tilleywoodworks.com/admin.html with the password you set.' : 'New password set for ' + esc(r.user.email) + '.', 'ok');
      e.target.reset();
      $('#user-submit').textContent = 'Add helper';
      $('#user-form-title').textContent = 'Add a helper';
      loadUsers();
    } catch (err) {
      if (!handleAuthError(err)) setStatus(esc(friendlyError(err)), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  $('#ulist').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-user-remove]');
    if (!b) return;
    if (!armed(b, 'Tap again to remove')) return;
    try {
      await api('/api/users/' + encodeURIComponent(b.dataset.userRemove), { method: 'DELETE' });
      setStatus(esc(b.dataset.userRemove) + ' no longer has access.', 'ok');
      loadUsers();
    } catch (err) {
      if (!handleAuthError(err)) setStatus(esc(friendlyError(err)), 'err');
    }
  });

  // ---------- account ----------
  $('#pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/password', { method: 'POST', body: { current: $('#a-cur').value, password: $('#a-new').value } });
      e.target.reset();
      setStatus('Password changed.', 'ok');
    } catch (err) {
      if (!handleAuthError(err)) setStatus(esc(friendlyError(err)), 'err');
    }
  });

  // ---------- one-time import from the static site ----------
  $('#import-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!armed(btn, 'Tap again to import (replaces what\'s here)')) return;
    btn.disabled = true;
    try {
      setStatus('Reading the current site…', null, true);
      const r = await fetch('data/inventory.json?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('Couldn\'t read the current inventory file.');
      const old = await r.json();
      data = {
        settings: Object.assign({}, DEFAULT_DATA.settings, old.settings || {}),
        categories: old.categories || [],
        items: old.items || []
      };
      // Copy each site photo into pending so Publish uploads it to the server.
      const refs = [...imageRefs()].filter((p) => !/^img\//.test(p));
      const map = new Map();
      for (let k = 0; k < refs.length; k++) {
        setStatus('Copying photo ' + (k + 1) + ' of ' + refs.length + '…', null, true);
        const res = await fetch(refs[k], { cache: 'no-store' });
        if (!res.ok) continue;
        const blob = await res.blob();
        const tmp = await processImage(blob, refs[k].replace(/^.*\//, '').replace(/\.[a-z]+$/i, ''));
        map.set(refs[k], tmp);
      }
      replacePaths(map);
      renderAll();
      await publish();
    } catch (err) {
      setStatus(esc(friendlyError(err)), 'err', true);
    } finally {
      btn.disabled = false;
    }
  });

  boot();
})();
