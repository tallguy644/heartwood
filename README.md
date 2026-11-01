# Tilley Woodworks shop site (GitHub Pages)

This branch (`gh-pages`) is the live shop at **https://tilleywoodworks.com**.
The Shopify theme and the inventory server (`server/`) live on the `main` branch.

- `index.html` is the public shop. It reads the inventory from the backend set in `assets/config.js`
  (`window.TW_API`), and falls back to `data/inventory.json` if that is empty or unreachable.
- `admin.html` is the inventory manager: **https://tilleywoodworks.com/admin.html**
  - Sign in with an email and password. The owner adds and removes staff on the **Staff** tab.
  - Add, edit and delete pieces, upload photos, set prices, mark pieces sold or hidden.
  - Rename the store, edit home page text, and manage categories.
  - **Publish** saves to the backend; the live site shows changes within a minute.
- Photos uploaded through the admin are stored on the backend (`img/…`). `images/` holds the original site photos.

## Backend

A Cloudflare Worker with KV storage (`server/` on `main`), deployed by GitHub Actions on every push to `main`
that touches `server/`. It needs two repo secrets: `CLOUDFLARE_API_TOKEN` and `OWNER_SETUP_CODE`.
The setup code is used once on the admin page to create the owner account.
