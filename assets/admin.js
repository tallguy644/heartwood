(function () {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const STATUS = { 'available': 'Available', 'made-to-order': 'Made to order', 'sold': 'Sold', 'hidden': 'Hidden' };
  const STORE_KEY = 'heartwood-admin-v1';
  const INVENTORY_PATH = 'data/inventory.json';

  const DEFAULT_DATA = {
    settings: { storeName: 'Tilley Woodworks', tagline: '', heroEyebrow: '', heroHeading: '', heroText: '', heroImage: '', aboutHeading: '', aboutText: '', contactEmail: '', contactPhone: '', customOrdersText: '' },
    categories: [],
    items: []
  };

  // ---------- state ----------
  let cfg = null;              // { owner, repo, branch, token }
  let data = null;             // working inventory
  let published = '';          // JSON of last published inventory
  let publishedRefs = new Set(); // image paths that exist on the site
  const pending = new Map();   // path -> base64 (new uploads not yet published)
  const previews = new Map();  // path -> data URL (so new photos show before the site serves them)
  let draft = null;            // piece being edited
  let draftIsNew = false;
  let busy = false;

  // ---------- storage ----------
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveCfg(c) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch (e) { /* private mode: stays for this visit */ }
  }
  function clearCfg() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- GitHub API ----------
  async function gh(path, opts) {
    opts = opts || {};
    const headers = {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const r = await fetch('https://api.github.com' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).message || msg; } catch (e) { /* ignore */ }
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }
  const repoPath = () => '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);

  function b64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function friendlyError(e) {
    if (e.status === 401) return 'GitHub rejected the token. It may have expired or been revoked. Disconnect and paste a new one.';
    if (e.status === 403) return 'The token can\'t write to this repo. Make sure Contents is set to "Read and write" for heartwood.';
    if (e.status === 404) return 'GitHub couldn\'t find that repo or branch. Check the user, repo and branch names.';
    if (e.status === 409 || e.status === 422) return 'GitHub refused the update (' + e.message + '). Reload the page and try again.';
    if (e instanceof TypeError) return 'Couldn\'t reach GitHub. Check your internet connection and try again.';
    return 'Something went wrong: ' + e.message;
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

  // ---------- connect ----------
  async function connect(c) {
    cfg = c;
    const repo = await gh(repoPath());
    if (repo.permissions && repo.permissions.push === false) {
      const e = new Error('no push'); e.status = 403; throw e;
    }
    try {
      const file = await gh(repoPath() + '/contents/' + INVENTORY_PATH + '?ref=' + encodeURIComponent(cfg.branch));
      data = JSON.parse(b64ToUtf8(file.content));
    } catch (e) {
      if (e.status !== 404) throw e;
      data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    data.settings = Object.assign({}, DEFAULT_DATA.settings, data.settings || {});
    data.categories = data.categories || [];
    data.items = data.items || [];
    published = JSON.stringify(data);
    publishedRefs = imageRefs();
  }

  $('#connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = {
      owner: $('#c-owner').value.trim(),
      repo: $('#c-repo').value.trim(),
      branch: $('#c-branch').value.trim() || 'gh-pages',
      token: $('#c-token').value.trim()
    };
    const btn = $('#connect-btn');
    btn.disabled = true;
    $('#connect-msg').textContent = 'Connecting…';
    try {
      await connect(c);
      saveCfg(c);
      showApp();
    } catch (err) {
      $('#connect-msg').textContent = friendlyError(err);
    } finally {
      btn.disabled = false;
    }
  });

  async function boot() {
    const saved = loadCfg();
    if (saved && saved.token) {
      try {
        await connect(saved);
        showApp();
        return;
      } catch (err) {
        $('#connect-msg').textContent = friendlyError(err);
        $('#c-owner').value = saved.owner; $('#c-repo').value = saved.repo; $('#c-branch').value = saved.branch;
      }
    }
    $('#connect').hidden = false;
  }

  function showApp() {
    $('#connect').hidden = true;
    $('#app').hidden = false;
    $('#view-live').href = 'https://tilleywoodworks.com/';
    $('#conn-info').textContent = cfg.owner + '/' + cfg.repo + ' (' + cfg.branch + ')';
    renderAll();
  }

  $('#disconnect').addEventListener('click', () => {
    if (isDirty() && !armed($('#disconnect'), 'Unpublished changes will be lost. Tap again')) return;
    clearCfg();
    location.reload();
  });

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
  function imageRefs() {
    const s = new Set();
    data.items.forEach((i) => (i.images || []).forEach((p) => s.add(p)));
    if (data.settings.heroImage) s.add(data.settings.heroImage);
    return s;
  }
  const imgSrc = (p) => previews.get(p) || p;

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
    const path = 'images/' + (slug(baseName) || 'photo') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg';
    pending.set(path, dataUrl.split(',')[1]);
    previews.set(path, dataUrl);
    return path;
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

  async function publish() {
    if (busy || !isDirty()) return;
    busy = true;
    updatePublishButton();
    setStatus('Publishing to your site…', null, true);
    try {
      const refPath = repoPath() + '/git/ref/heads/' + encodeURIComponent(cfg.branch);
      const ref = await gh(refPath);
      const headSha = ref.object.sha;
      const head = await gh(repoPath() + '/git/commits/' + headSha);

      const refsNow = imageRefs();
      const tree = [];
      for (const p of refsNow) {
        if (!pending.has(p)) continue;
        const blob = await gh(repoPath() + '/git/blobs', { method: 'POST', body: { content: pending.get(p), encoding: 'base64' } });
        tree.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
      }
      publishedRefs.forEach((p) => {
        if (!refsNow.has(p) && p.startsWith('images/')) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
      });
      tree.push({ path: INVENTORY_PATH, mode: '100644', type: 'blob', content: JSON.stringify(data, null, 2) + '\n' });

      const newTree = await gh(repoPath() + '/git/trees', { method: 'POST', body: { base_tree: head.tree.sha, tree } });
      const n = changeCount();
      const commit = await gh(repoPath() + '/git/commits', {
        method: 'POST',
        body: { message: 'Update inventory (' + n + (n === 1 ? ' change' : ' changes') + ') from shop admin', tree: newTree.sha, parents: [headSha] }
      });
      await gh(repoPath() + '/git/refs/heads/' + encodeURIComponent(cfg.branch), { method: 'PATCH', body: { sha: commit.sha } });

      published = JSON.stringify(data);
      publishedRefs = refsNow;
      refsNow.forEach((p) => pending.delete(p));
      busy = false;
      renderAll();
      setStatus('Published. Your live site updates in about a minute. <a href="' + esc($('#view-live').href) + '" target="_blank" rel="noopener">View site ↗</a>', 'ok', true);
    } catch (err) {
      busy = false;
      updatePublishButton();
      setStatus(esc(friendlyError(err)) + ' Your changes are still here.', 'err', true);
    }
  }

  boot();
})();
