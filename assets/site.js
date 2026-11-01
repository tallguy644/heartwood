(function () {
  'use strict';

  const STATUS = {
    'available': 'Available',
    'made-to-order': 'Made to order',
    'sold': 'Sold'
  };
  const ORDER = { 'available': 0, 'made-to-order': 1, 'sold': 2 };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const priceText = (item) => (item.price == null || item.price === '' ? 'Ask for price' : money.format(Number(item.price)));

  let data = null;
  let filter = 'all';

  document.getElementById('year').textContent = new Date().getFullYear();

  const API = String(window.TW_API || '').replace(/\/+$/, '');
  // Photos uploaded through the admin live on the backend ("img/…"); older ones ship with the site.
  const src = (p) => (API && /^img\//.test(p) ? API + '/' + p : p);

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  (API ? getJson(API + '/api/inventory').catch(() => getJson('data/inventory.json?v=' + Date.now())) : getJson('data/inventory.json?v=' + Date.now()))
    .then((d) => { data = d; renderAll(); openFromHash(); })
    .catch(() => {
      document.getElementById('grid').innerHTML = '<p class="empty">Pieces could not be loaded right now. Please refresh in a moment.</p>';
    });

  function visibleItems() {
    return (data.items || [])
      .filter((i) => i.status !== 'hidden')
      .sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function categoryName(id) {
    const c = (data.categories || []).find((c) => c.id === id);
    return c ? c.name : '';
  }

  function renderAll() {
    const s = data.settings || {};
    const name = s.storeName || 'Tilley Woodworks';
    document.title = name + (s.tagline ? ' — ' + s.tagline : '');
    document.querySelectorAll('[data-store-name]').forEach((el) => { el.textContent = name; });
    document.querySelectorAll('[data-s]').forEach((el) => {
      const v = s[el.dataset.s];
      if (v) el.textContent = v;
    });
    const hero = document.getElementById('hero-img');
    if (s.heroImage) hero.src = src(s.heroImage);
    hero.alt = 'Work from ' + name;

    renderContact();
    renderChips();
    renderGrid();
    renderPieceSelect();
  }

  function renderContact() {
    const s = data.settings || {};
    const lines = [];
    if (s.contactEmail) lines.push('<p><strong>Email</strong><a href="mailto:' + esc(s.contactEmail) + '">' + esc(s.contactEmail) + '</a></p>');
    if (s.contactPhone) lines.push('<p><strong>Call or text</strong><a href="tel:' + esc(s.contactPhone.replace(/[^\d+]/g, '')) + '">' + esc(s.contactPhone) + '</a></p>');
    document.getElementById('contact-lines').innerHTML = lines.join('');
  }

  function renderChips() {
    const items = visibleItems();
    const used = (data.categories || []).filter((c) => items.some((i) => i.categoryId === c.id));
    const chips = [{ id: 'all', name: 'All' }].concat(used);
    const el = document.getElementById('chips');
    el.hidden = used.length < 2;
    el.innerHTML = chips.map((c) => '<button type="button" class="chip" data-cat="' + esc(c.id) + '" aria-pressed="' + (filter === c.id) + '">' + esc(c.name) + '</button>').join('');
  }

  document.getElementById('chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    filter = b.dataset.cat;
    renderChips();
    renderGrid();
  });

  function renderGrid() {
    const items = visibleItems().filter((i) => filter === 'all' || i.categoryId === filter);
    const grid = document.getElementById('grid');
    if (!items.length) {
      grid.innerHTML = '<p class="empty">New pieces are on the bench. Check back soon, or <a href="#custom">ask for a custom one</a>.</p>';
      return;
    }
    grid.innerHTML = items.map((i) => {
      const img = (i.images && i.images[0])
        ? '<img src="' + esc(src(i.images[0])) + '" alt="' + esc(i.name) + '" loading="lazy">'
        : '<div class="noimg">Photo coming soon</div>';
      let badge = '';
      if (i.status === 'sold') badge = '<span class="badge badge--dark">Sold</span>';
      else if (i.status === 'made-to-order') badge = '<span class="badge">Made to order</span>';
      else if (i.oneOfAKind) badge = '<span class="badge">One of a kind</span>';
      const meta = [categoryName(i.categoryId), i.wood].filter(Boolean).join(' · ');
      return '<button type="button" class="card' + (i.status === 'sold' ? ' card--sold' : '') + '" data-id="' + esc(i.id) + '">' +
        '<div class="card__img">' + img + badge + '</div>' +
        '<h3>' + esc(i.name) + '</h3>' +
        (meta ? '<p class="card__meta">' + esc(meta) + '</p>' : '') +
        '<p class="price">' + (i.status === 'sold' ? 'Sold' : esc(priceText(i))) + '</p>' +
        '</button>';
    }).join('');
  }

  document.getElementById('grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (card) openPiece(card.dataset.id, true);
  });

  // Piece detail
  const dlg = document.getElementById('piece');

  function openPiece(id, pushHash) {
    const i = (data.items || []).find((x) => x.id === id && x.status !== 'hidden');
    if (!i) return;
    const s = data.settings || {};
    const imgs = i.images || [];
    const specs = [['Category', categoryName(i.categoryId)], ['Wood', i.wood], ['Dimensions', i.dimensions], ['Finish', i.finish]]
      .filter((p) => p[1]).map((p) => '<div><dt>' + p[0] + '</dt><dd>' + esc(p[1]) + '</dd></div>').join('');

    const subject = encodeURIComponent((i.status === 'sold' ? 'Something like: ' : 'Interested in: ') + i.name);
    const body = encodeURIComponent('Hi! I\'m interested in "' + i.name + '".\n\nLink: ' + location.href.split('#')[0] + '#p-' + i.id + '\n\n');
    let ask = '';
    if (s.contactEmail || s.contactPhone) {
      ask = '<div class="piece__ask">' +
        (s.contactEmail ? '<a class="btn" href="mailto:' + esc(s.contactEmail) + '?subject=' + subject + '&body=' + body + '">' + (i.status === 'sold' ? 'Ask for one like it' : 'Ask about this piece') + '</a>' : '') +
        '<p class="form-note">' +
          (s.contactEmail ? 'Email ' + esc(s.contactEmail) : '') +
          (s.contactEmail && s.contactPhone ? ' · ' : '') +
          (s.contactPhone ? 'Call or text ' + esc(s.contactPhone) : '') +
        '</p></div>';
    } else {
      ask = '<a class="btn" href="#custom" data-close>Ask about this piece</a>';
    }

    dlg.innerHTML =
      '<button class="piece__close" type="button" aria-label="Close" data-close>&times;</button>' +
      '<div class="piece__inner">' +
        '<div class="piece__gallery">' +
          (imgs.length ? '<img class="piece__main" id="piece-main" src="' + esc(src(imgs[0])) + '" alt="' + esc(i.name) + '">' : '<div class="noimg piece__main">Photo coming soon</div>') +
          (imgs.length > 1 ? '<div class="piece__thumbs">' + imgs.map((p, n) => '<button type="button" data-img="' + esc(src(p)) + '" aria-current="' + (n === 0) + '" aria-label="Photo ' + (n + 1) + '"><img src="' + esc(src(p)) + '" alt=""></button>').join('') + '</div>' : '') +
        '</div>' +
        '<div class="piece__body">' +
          '<div><span class="status status--' + esc(i.status) + '">' + (STATUS[i.status] || '') + '</span></div>' +
          '<h2 id="piece-title">' + esc(i.name) + '</h2>' +
          (i.status !== 'sold' ? '<p class="price piece__price">' + esc(priceText(i)) + '</p>' : '') +
          (i.description ? '<p class="piece__desc">' + esc(i.description) + '</p>' : '') +
          (specs ? '<dl class="specs">' + specs + '</dl>' : '') +
          ask +
        '</div>' +
      '</div>';

    if (!dlg.open) dlg.showModal();
    if (pushHash) history.replaceState(null, '', '#p-' + i.id);
  }

  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('[data-img]');
    if (t) {
      document.getElementById('piece-main').src = t.dataset.img;
      dlg.querySelectorAll('[data-img]').forEach((b) => b.setAttribute('aria-current', String(b === t)));
      return;
    }
    if (e.target.closest('[data-close]') || e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    if (location.hash.startsWith('#p-')) history.replaceState(null, '', location.pathname + location.search);
  });

  function openFromHash() {
    if (location.hash.startsWith('#p-')) openPiece(decodeURIComponent(location.hash.slice(3)), false);
  }
  window.addEventListener('hashchange', openFromHash);

  // Custom order form → email
  function renderPieceSelect() {
    const sel = document.getElementById('f-piece');
    const opts = (data.categories || []).map((c) => c.name).concat(['Something else']);
    sel.innerHTML = opts.map((o) => '<option>' + esc(o) + '</option>').join('');
    const note = document.getElementById('form-note');
    if (!data.settings.contactEmail) note.textContent = 'Custom requests open soon.';
  }

  document.getElementById('order-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = (data && data.settings) || {};
    const note = document.getElementById('form-note');
    if (!s.contactEmail) { note.textContent = 'Custom requests open soon. Please check back.'; return; }
    const v = (id) => document.getElementById(id).value.trim();
    const body = [
      'Name: ' + v('f-name'),
      'Piece: ' + v('f-piece'),
      'Size: ' + (v('f-size') || '—'),
      'Budget: ' + v('f-budget'),
      '',
      v('f-details')
    ].join('\n');
    location.href = 'mailto:' + s.contactEmail + '?subject=' + encodeURIComponent('Custom order request: ' + v('f-piece')) + '&body=' + encodeURIComponent(body);
    note.textContent = 'Your email app should open with the request filled in. If it doesn\'t, email ' + s.contactEmail + ' directly.';
  });
})();
