# ISAM 2026 print materials

Made for the demo session on Sunday 11 October 2026. Same identity as the first
poster: warm paper, ink, one safety-orange accent, square corners.

| File | What | Print |
|---|---|---|
| `poster-2.html`, `MakerLAB AI - ISAM 2026 Poster 2 (11x17).pdf` | Poster 2: a QR code to `https://www.makerlabai.app/demo`, three steps, six questions to try with the manual page each answer cites | 11 × 17 in (tabloid), 100% / actual size, no margins |
| `cards.html`, `MakerLAB AI - ISAM 2026 Cards (Letter).pdf` | Ten 3.5 × 2 in handout cards: the MakerLAB AI lockup, a one-line description, the official logo, a QR code to `https://www.makerlabai.app` | US Letter, 100%, then cut on the crop marks. The grid is the standard 10-up business-card layout (0.75 in sides, 0.5 in top and bottom); on perforated card stock, untick **Cut guides** before printing |

`img/` holds the official logo (the same file as `public/brand/cornell-tech-makerlab-logo.svg`),
the MakerLAB lettering cropped from it, and the two QR codes (error correction M, generated
with the `qrcode` package and checked by decoding the rendered pages).

The PDFs were printed from these pages with headless Chromium and the Google Fonts faces
the pages name (Space Grotesk, Inter, JetBrains Mono, Barlow). To change a page, edit the
HTML, open it in Chrome and print it at actual size with background graphics on.

The six example questions were checked against the live lab's manual search on
2026-10-10; each cited page is the top passage that search returned.
