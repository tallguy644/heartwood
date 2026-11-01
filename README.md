# Tilley Woodworks shop site (GitHub Pages)

This branch (`gh-pages`) is the live shop at **https://tallguy644.github.io/heartwood/**.
The Shopify theme lives on the `main` branch.

- `index.html` is the public shop. It reads everything from `data/inventory.json`.
- `admin.html` is the inventory manager: **https://tallguy644.github.io/heartwood/admin.html**
  - Add, edit and delete pieces, upload photos, set prices, mark pieces sold or hidden.
  - Rename the store, edit home page text, and manage categories.
  - **Publish** commits your changes here in one commit; the live site updates in about a minute.
- `images/` holds piece photos. The admin resizes uploads to 1800px JPEGs before publishing.

## First-time admin setup

Create a fine-grained GitHub token: Settings → Developer settings → Personal access tokens → Fine-grained tokens.
Give it access to **only** the `heartwood` repo, with **Contents: Read and write**. Paste it into the admin page once per device; it is stored only in that browser.
