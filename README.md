# Heartwood — Shopify theme for handmade woodworking

A rustic, warm Online Store 2.0 theme for selling handmade wood pieces (live-edge shelves, boards, furniture) and taking custom commission requests.

## What's included

- **Home page** — split hero with the live-edge shelves photo, featured pieces, "why it's made to last", shop-by-category tiles, meet-the-maker, numbered "from tree to your wall" process, and a custom-order banner. Every section is editable in the theme editor.
- **Product page** — gallery with thumbnails, variant pills, spec table (wood, dimensions, finish, lead time), care and shipping accordions, and a "Request a custom version" link that pre-fills the commission form.
- **Custom order page** (`page.commission` template) — a 4-step explainer plus a request form (piece type, wood, size, budget, needed-by date, details). Submissions arrive in your Shopify contact email.
- Collection, cart, search, blog, article, 404 and password ("opening soon" with email signup) pages.
- "One of a kind" badge for any product tagged `one-of-a-kind` (also caps quantity at 1).

## Set up the store

1. Create a store at shopify.com and choose a plan.
2. **Online Store → Themes → Add theme → Connect from GitHub**, pick this repo and the `main` branch. Changes pushed to GitHub sync to the store automatically.
3. Click **Customize** on the theme to edit text, colors, fonts and images.

## Recommended setup in Shopify admin

**Custom order page**
1. Online Store → Pages → Add page. Title: "Custom orders". Add a short intro in the content box.
2. In *Theme template*, choose **commission**.
3. In the theme editor → Theme settings → Commissions, select that page so all "Request a custom piece" buttons point to it. (Without this, buttons go to `/pages/commissions`.)

**Product details (metafields)** — Settings → Custom data → Products → Add definition, namespace `custom`:

| Key | Type | Example |
|---|---|---|
| `wood_species` | Single line text | Black walnut |
| `dimensions` | Single line text | 36" W × 10" D × 2" thick |
| `finish` | Single line text | Hardwax oil |
| `lead_time` | Single line text | 2–3 weeks |
| `care` | Rich text | (overrides the default care text) |

**Menus** — Online Store → Navigation: the header uses `main-menu` and the footer uses `footer`. Suggested main menu: Shop, Shelves, Boards, Custom orders, About.

**Collections** — create a few (e.g. Floating Shelves, Cutting Boards, Furniture), then pick them in the home page's *Featured collection* and *Collection list* sections.

## Replace before launch

- Meet-the-maker photo and story (home page).
- The hero uses `assets/live-edge-shelves.jpg` until you pick another image in the editor.

## Develop locally

```bash
npm i -g @shopify/cli
shopify theme dev --store your-store.myshopify.com
shopify theme check
```
