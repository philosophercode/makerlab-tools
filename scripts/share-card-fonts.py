"""Static TTF instances of the site's variable fonts for the link-preview cards.

The share cards (`src/app/opengraph-image.tsx`, `apple-icon.tsx`) are drawn by
`next/og`, whose renderer reads TTF/OTF/WOFF but not WOFF2 and does not pick a
weight from a variable font. So the Latin faces under `src/fonts/` are pinned
to the weights the cards use and written as TTF beside the card code.

Run from the repo root after changing a face under `src/fonts/`:

    python3 scripts/share-card-fonts.py

Needs `fonttools` and `brotli` (pip). Both families are SIL OFL 1.1 with no
Reserved Font Name; their licences are copied beside the output.
"""

import shutil
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = "src/lib/share/fonts"
FACES = [
    ("SpaceGrotesk-Latin", 700, "SpaceGrotesk-Bold"),
    ("Inter-Latin", 400, "Inter-Regular"),
]

for source, weight, name in FACES:
    font = TTFont(f"src/fonts/{source}.woff2")
    static = instancer.instantiateVariableFont(font, {"wght": weight})
    static.flavor = None
    static.save(f"{OUT}/{name}.ttf")

for licence in ("OFL-SpaceGrotesk.txt", "OFL-Inter.txt"):
    shutil.copy(f"src/fonts/{licence}", f"{OUT}/{licence}")
