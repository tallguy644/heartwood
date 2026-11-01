(function () {
  'use strict';

  // Mobile navigation
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-site-nav]');
  if (toggle && nav) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  // Collection sort
  const sortSelect = document.querySelector('[data-sort-select]');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('sort_by', sortSelect.value);
      url.searchParams.delete('page');
      window.location.href = url.toString();
    });
  }

  // Product gallery thumbnails
  document.querySelectorAll('[data-thumb]').forEach((thumb) => {
    thumb.addEventListener('click', () => showMedia(thumb.dataset.thumb));
  });

  function showMedia(mediaId) {
    if (!mediaId) return;
    const target = document.querySelector('[data-media-id="' + mediaId + '"]');
    if (!target) return;
    document.querySelectorAll('[data-media-id]').forEach((el) => el.classList.toggle('is-active', el === target));
    document.querySelectorAll('[data-thumb]').forEach((el) => el.classList.toggle('is-active', el.dataset.thumb === String(mediaId)));
  }

  // Variant selection
  const form = document.querySelector('[data-product-form]');
  const variantsEl = document.querySelector('[data-variants]');
  if (form && variantsEl) {
    const variants = JSON.parse(variantsEl.textContent);
    const idInput = form.querySelector('[data-variant-id]');
    const addButton = form.querySelector('[data-add-button]');
    const priceEl = document.querySelector('[data-price-wrapper] [data-price]');
    const moneyFormat = new Intl.NumberFormat(document.documentElement.lang || 'en', {
      style: 'currency',
      currency: (window.Shopify && Shopify.currency && Shopify.currency.active) || 'USD'
    });

    form.addEventListener('change', (e) => {
      if (!e.target.matches('[data-option-input]')) return;
      const selected = [1, 2, 3].map((i) => {
        const checked = form.querySelector('input[name="option' + i + '"]:checked');
        return checked ? checked.value : null;
      });
      const variant = variants.find((v) => v.options.every((opt, i) => opt === selected[i]));

      if (!variant) {
        addButton.disabled = true;
        addButton.textContent = 'Unavailable';
        return;
      }

      idInput.value = variant.id;
      addButton.disabled = !variant.available;
      addButton.textContent = variant.available ? 'Add to cart' : 'Sold out';

      if (priceEl) {
        let html = '<span class="price__current">' + moneyFormat.format(variant.price / 100) + '</span>';
        if (variant.compare_at_price && variant.compare_at_price > variant.price) {
          html += '<s class="price__compare">' + moneyFormat.format(variant.compare_at_price / 100) + '</s>';
        }
        priceEl.innerHTML = html;
        priceEl.classList.toggle('price--on-sale', variant.compare_at_price > variant.price);
      }

      if (variant.featured_media) showMedia(variant.featured_media.id);

      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    });
  }

  // Commission form: prefill from "Request a custom version" links (?piece=Product name)
  const commissionForm = document.getElementById('CommissionForm');
  if (commissionForm) {
    const piece = new URLSearchParams(window.location.search).get('piece');
    const details = commissionForm.querySelector('textarea[name="contact[body]"]');
    if (piece && details && !details.value) {
      details.value = 'I\'d like a custom version of "' + piece + '". ';
    }
  }
})();
