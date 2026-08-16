# Brand SVG sources

Source artwork for the marks printed on cards — issuing banks, co-brand
programmes, and the RuPay network mark.

**These are build inputs, not shipped assets.** They deliberately live outside
`public/`: Vite copies `public/` verbatim into `dist/` and Capacitor packages
that into the APK, so keeping them there would ship ~750KB of SVG that nothing
loads at runtime. `scripts/gen-card-logos.py` inlines the ones it needs into
`src/components/CardBrandLogo.tsx` and `CardNetworkRupay.tsx`, which is what
actually renders — inline also means they work offline in the webview and can
take their colour from `--card-ink`.

## Regenerating

    python3 scripts/gen-card-logos.py

Edit that script — never the generated `.tsx` files.

## Which files are actually used

| Mark | File | Colour policy |
|---|---|---|
| HDFC Bank | `issuers/hdfc.svg` | `original` |
| Axis Bank | `issuers/axis(1).svg` | `white` |
| CSB Bank | `issuers/csb.svg` | `reversed` |
| Tide | `issuers/tide(3).svg` | `white` |
| Swiggy | `issuers/swiggy.svg` | `original` |
| super.money | `issuers/super.money.svg` | `white` |
| Jupiter | `issuers/jupiter(1).svg` | `white` |
| RuPay | `networks/rupay.svg` | wordmark recoloured, chevrons kept |

Everything else is an unused alternate kept for later. Known-bad ones, left in
place only so nobody re-downloads them and hits the same problem: `tide.svg`
(auto-traced bitmap — 310 noise paths), `rupay(2).svg` (1,467 traced paths),
`federal(1).svg` and the original `icici.svg`/`idfc.svg` (embedded rasters),
`mastercard(1).png` and `visa(2).png` (not SVG at all).

## Colour policies

- **`white`** — every fill becomes `currentColor`. For single-colour lockups.
- **`original`** — keeps brand colours. For plate logos whose wordmark is
  *knocked out* of a solid block: recolouring those to one fill collapses the
  whole mark into a white rectangle.
- **`reversed`** — drops the full-bleed background plate *and* every shape
  painted in the plate's own colour, then whitens the rest. Only works where the
  plate is its own element. CSB has a `<rect>` plate plus four corner pieces in
  the plate colour that are invisible until it's removed.

## If you add a file

- Text must be converted to outlines. An SVG with `<text>` renders in whatever
  font the device has.
- Real paths, not a raster wrapped in `<svg>`.
- Check it isn't auto-traced — look for `imagetracer` in the root tag.
