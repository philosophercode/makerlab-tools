# Inventory cleanup — 2026-09-28

A reviewed data bundle for the local inventory (snapshot of the local PGlite, 105 tools, 104 not archived; 227 resources). Applied by `npm run inventory:cleanup` (dry run by default, `--apply` to write) — see `docs/operations.md` › *One-off data cleanups*. Every change is conditional on the value it replaces, so re-running is safe and a value somebody edited since the snapshot is left alone.

## Counts

| Change | Count |
|---|---|
| Manual links found (tools that had no Manual resource) | 25 (high 12, medium 9, low 4) |
| — no manual expected (hand tools, hoses, clamps, consumables) | 29 |
| — not found | 5 |
| Tool display names changed | 32 |
| — official names filled (were empty; from the record's own description) | 11 |
| Unit labels changed | 51 |
| Tags removed | 193 across 18 tools |
| Tags added (plain words salvaged from the removed ones) | 23 |
| Tools given starter questions | 103 (309 questions) |
| Resource links with tracking parameters stripped | 4 |

### Starter questions per tool (not archived)

| Questions | Before | After |
|---|---|---|
| 0 | 103 | 0 |
| 1 | 0 | 0 |
| 2 | 0 | 0 |
| 3+ | 1 | 104 |

Low-confidence manual links are **not** added unless the command is run with `--include-low`.

Rehearsed on a copy of the local database: the dry run and `--apply` both report 240 changes (32 names, 11 official names, 51 unit labels, 18 tag edits, 103 starter-question sets, 21 manuals, 4 links; 4 low-confidence manuals skipped), none refused; a second `--apply` reports every one `already` and writes nothing.

## 1. Manual links (`manuals.json`)

Each found link was checked with `curl`: HTTP 200, `application/pdf`, starts with `%PDF`, ≤ 25 MB. Added as a resource of type **Manual**, so the nightly manual archive copies the PDF and `npm run manuals:index` reads it.

**Already linked, filed as SOP.** Form 2, Ultimaker 3 and Ultimaker 3 Extended (and Rockwell BladeRunner X2, low confidence) already link these exact PDFs as resources of type SOP titled “… - SOP”. The command retypes that link as a Manual with the manual's title instead of listing the same PDF twice.

### Found

| Tool | Title | Confidence | Source | Size | Link | Note |
|---|---|---|---|---|---|---|
| Bofa Fume Extractor | BOFA AD 500 iQ User Manual | medium | donaldsonbofa.com (official) | 0.8 MB | https://www.donaldsonbofa.com/wp-content/uploads/2024/08/Donaldson-BOFA-AD-500-iQ-User-Manual-UK.pdf | official manual for AD 500 iQ; record says AD500 without iQ, so exact variant ambiguous (older non-iQ manual only on a third-party wiki) |
| Brother Compact Monochrome Laser Printer | Brother HL-L2400D Online User's Guide | high | support.brother.com (official) | 2.6 MB | https://support.brother.com/g/s/id/htmldoc/printer/cv_hll2460dw/use/PDF/PDF.pdf | official PDF user's guide covering HL-L2400D and sibling models |
| Cricut Easy Press 3 | Cricut EasyPress 3 User Guide | high | Cricut official CDN (d2e2oszluhwxlw.cloudfront.net, linked from help.cricut.com) | 0.1 MB | https://d2e2oszluhwxlw.cloudfront.net/help/manuals/cricut-easypress-3-user-guide-namr.pdf | official North America user guide for exact model |
| Dremel 3000 | Dremel 3000 Operating/Safety Instructions | high | dremel.com (official) | 3.5 MB | https://www.dremel.com/storage/en-us/3000-1-25h-33978-original$pdf-246670-en-us.pdf | official US operating/safety instructions for exact model (EN/FR/ES) |
| Festool Dust Extractor | Festool CT MINI I / CT MIDI I HEPA Original Instructions | medium | media.cdn.festool.io (official) | 9.7 MB | https://media.cdn.festool.io/productmedia/Images/attachment/8ec81cba-8af1-11eb-8115-005056b31774.pdf | successor model (CT MIDI I HEPA); exact 575267 manual on festoolusa.com returns an empty body to curl |
| Festool Bench | Festool MFT/3 Original Instructions | high | media.cdn.festool.io (official, linked from festool.com product page) | 2.2 MB | https://media.cdn.festool.io/productmedia/Images/attachment/d391dba7-ebb8-11f0-8a6a-005056b3ad01.pdf | official PDF for exact model; multilingual, English section starts p.8 |
| FESTOOL PS 300 EQ-PLUS TRION JIGSAW | Festool Trion PS 300 EQ Original Instructions | high | media.cdn.festool.io (official) | 1.7 MB | https://media.cdn.festool.io/productmedia/Images/attachment/1ef8dce4-331a-11eb-8111-005056b31774.pdf | official US edition (EN/FR/ES) for exact model |
| Form 2 | Form 2 Manual | high | media.formlabs.com (official) | 0.6 MB | https://media.formlabs.com/m/7253926716b40054/original/-ENUS-Form-2-Manual.pdf | official PDF for exact model; already on file as a non-Manual resource |
| Form Cure | Form Cure V2 Manual | high | media.formlabs.com (official) | 0.5 MB | https://media.formlabs.com/m/c401ff26124914/original/-ENUS-Form-Cure-2nd-Generation-Manual.pdf | official manual for Form Cure 2nd Generation (record says V2) |
| Infrared IC Heater | PUHUI T-962 Infrared IC Heater User Manual | medium | puhuit.com (official) | 0.9 MB | https://www.puhuit.com/videos/700MBCD/T962/INFRARED%20IC%20HEATER%20T-962%20User%20Manual.pdf | official manual for T-962; model taken from description (PUHUI T-962), record name is generic |
| MAKITA Plunge Base | Makita RT0700C / RT0701C Instruction Manual | medium | cdn.makitatools.com (official) | 2.7 MB | https://cdn.makitatools.com/apps/cms/doc/prod/RT0/647d7eb3-3b81-48d3-b5c1-3ae0fe4e121d_RT0701C_IM.pdf | no standalone plunge-base manual; router manual covers plunge base setup |
| Makita Compact Router | Makita RT0700C / RT0701C Instruction Manual | high | cdn.makitatools.com (official) | 2.7 MB | https://cdn.makitatools.com/apps/cms/doc/prod/RT0/647d7eb3-3b81-48d3-b5c1-3ae0fe4e121d_RT0701C_IM.pdf | official PDF for exact model, linked from makitatools.com product page |
| Matter and Form 3D Scanner | Matter and Form 3D Scanner V1/V2 User Manual | medium | matterandform.net (official, Shopify CDN) | 1.4 MB | https://cdn.shopify.com/s/files/1/0634/4346/8486/files/MFStudio_User-Manual_EN.pdf | official V1/V2 manual linked from matterandform.net/pages/v2; exact generation not stated in record |
| Meta Quest 2 VR Headset | Meta Quest 2 Safety and Warranty Guide | low | third-party HubSpot host | 1.1 MB | https://2876316.fs1.hubspotusercontent-na1.net/hubfs/2876316/Website/meta%20quest%202%20guide.pdf | official Meta copies are signed/expiring fbcdn URLs; this is a third-party copy of Meta's safety guide, not a full user manual |
| Plunge Cut Track Saw TS 55 REQ-F-Plus | Festool TS 55 FEQ Operating Instructions | medium | media.cdn.festool.io (official, linked from festoolusa.com product page) | 3.5 MB | https://media.cdn.festool.io/productmedia/Images/attachment/4f022087-5dc8-11f1-8a72-005056b3ad01.pdf | closest model (TS 55 FEQ, current successor); festoolusa.com REQ manual URLs now return empty 200 responses; exact-model REQ/REBQ original instructions exist only on third-party hosts, e.g. https://www.quincaillerie-lapeyre.fr/media/wysiwyg/Fournisseurs/FESTOOL/506380.pdf (verified PDF, multilingual incl. English) |
| Prusa i3 MK3S+ | Original Prusa i3 MK3S+ Handbook | high | cdn.prusa3d.com (official, linked from help.prusa3d.com) | 17.7 MB | https://cdn.prusa3d.com/downloads/manual/prusa3d_manual_mk3s_en.pdf | official handbook v3.18 for exact model; unversioned URL tracks latest |
| Rockwell BladeRunner X2 | Rockwell BladeRunner X2 RK7323 Manual | low | pdf.lowes.com (Lowe's CDN, manufacturer PDF) | 9.0 MB | https://pdf.lowes.com/productdocuments/3ccc8552-491a-4ebc-afd3-4e8ff915ef4b/63059450.pdf | Rockwell's own trilingual manual for exact model, only found on retailer CDN; rockwelltools.com product page has no PDF |
| RYOBI Drill Press | RYOBI DP103L Drill Press Operator's Manual | low | images.thdstatic.com (Home Depot CDN, manufacturer PDF) | 3.1 MB | https://images.thdstatic.com/catalog/pdfImages/70/70dee0f4-a6b8-4cfe-b38b-bec0aaa745db.pdf | Ryobi operator's manual for exact model (DP103L), only on retailer CDN; ryobitools.com hosts none |
| RYOBI Impact Driver | RYOBI PCL235 Impact Driver Operator's Manual | low | images.thdstatic.com (Home Depot CDN, manufacturer PDF) | 1.3 MB | https://images.thdstatic.com/catalog/pdfImages/eb/ebd5e891-1c0a-40e6-8991-fcaf540ffa94.pdf | Ryobi operator's manual for exact model (PCL235), only on retailer CDN |
| Shaper Origin | Shaper Origin Product Manual | medium | assets.shapertools.com (official) | 1.1 MB | https://assets.shapertools.com/manual/origin/PKG-00056-C_ProductManualSO1-EN-SN-UN-ON.pdf | official Gen 1 (SO1) manual; generation not stated in record; no Gen 2 PDF found |
| ShopBot Buddy BT48 | ShopBot User Guide | medium | shopbottools.com (official, Buddy documentation page) | 2.3 MB | https://shopbottools.com/wp-content/uploads/2024/01/SBG-00142-User-Guide-20150317.pdf | general ShopBot user guide listed for Buddy; Buddy-specific setup manual also at https://shopbottools.com/wp-content/uploads/2024/01/BuddySetupManual.pdf |
| SKIL Multi - Detail Sander | SKIL SR232301 Multi-Sander Owner's Manual | high | skil.com (official) | 5.4 MB | https://www.skil.com/cdn/shop/files/SR232301_Manual.pdf | official PDF for exact model (cache-buster ?v param dropped; same file) |
| Structure Sensor | Structure Sensor Quick Start Guide | medium | s3.amazonaws.com/io.structure.assets (Structure/Occipital official asset bucket) | 3.0 MB | https://s3.amazonaws.com/io.structure.assets/Quick_Start_Guide_V1.2.pdf | quick-start guide (29 pp) for original ST01; no full manual published; path-style https URL used because virtual-host https fails cert check |
| Ultimaker 3 | Ultimaker 3 User Manual | high | um-support-files.ultimaker.com (official) | 12.6 MB | https://um-support-files.ultimaker.com/manuals/user-manual/UM3/Ultimaker%203%20-%20User%20manual%20EN%20v1.4.pdf | official PDF for exact model (already on file as a non-Manual resource) |
| Ultimaker 3 Extended | Ultimaker 3 User Manual | high | um-support-files.ultimaker.com (official) | 12.6 MB | https://um-support-files.ultimaker.com/manuals/user-manual/UM3/Ultimaker%203%20-%20User%20manual%20EN%20v1.4.pdf | official manual covers Ultimaker 3 and 3 Extended (already on file as a non-Manual resource) |

### No manual expected

| Tool | Note |
|---|---|
| AIRAJ HackSaw | hand tool |
| Apple Pencil | Apple publishes no user manual PDF; usage lives in the web-only iPad User Guide |
| Cowryman Router Plane | hand tool |
| DEWALT Screwdriver Bit Set | bit set |
| Dust Masks | PPE consumable |
| FULTON Hose Ring Clamp | hose clamp |
| Hercules Sanding Sheets | abrasive consumable |
| Hi-Spec Metal File Set | hand tool |
| Husky Coping Saw | hand tool |
| KOOTANS Spokeshave Planer | hand tool |
| Label Maker AC Adapter | AC adapter |
| Marples Japanese Pull Saw | hand tool |
| PEACHTREE WOODWORKING SUPPLY PVC Hose | hose |
| Plywood Stacking Rolling Cart | cart |
| POWERTEC Cone Reducer | dust-collection hose reducer |
| Spear & Jackson Tenon Saw | hand tool |
| Stanley Sweetheart Jack Plane | hand tool |
| Stanley Mini Utility Saw | hand tool |
| Stanley Mini Hacksaw | hand tool |
| STANLEY Coping Saw | hand tool |
| Stanley Block Plane | hand tool |
| Stanley Staple Gun | manual staple gun; Stanley support has a TR150HL instruction-sheet article (support.stanleytools.com/hc/en-us/articles/360012600657) but it returns 403 to automated fetches, so no PDF verified |
| STANLEY Wallboard Saw | hand tool |
| Stanley Short Cut Saw | hand tool |
| SUIZAN Dozuki Dovetail Saw | hand tool |
| SUIZAN Replacement Blade | replacement blade |
| Tripod with adapter | tripod |
| Valley Craft A Frame Bin Cart | cart |
| Woodworking Tools & Storage Bench | bench |

### Not found

| Tool | Note |
|---|---|
| BGA Rework Station | model not identifiable from record |
| Marvey Hotwire Foam Cutter | no instruction PDF published by Marvy Uchida or found elsewhere |
| Oscilloscope Textronix | model not identifiable from record |
| RYOBI Nail Gun | model not identifiable from record (P320/P321/P322 are all 18V 18GA). Existing link suggests P322 but no official P322 PDF found; P321 manual on Home Depot CDN (verified): https://images.thdstatic.com/catalog/pdfImages/3d/3d35f81c-42b0-4544-b07c-34207230191e.pdf |
| SMD Rework Station | model not identifiable from record |

## 2. Display names (`renames.json` › `tools`)

Display names only; slugs never change. An official name is written only where it was empty, and only from the model the tool's own description names.

| Slug | Before | After | Official name (filled) | Why |
|---|---|---|---|---|
| `airaj-hacksaw` | AIRAJ HackSaw | AIRAJ Hacksaw |  | “HackSaw” → “Hacksaw” |
| `bosch-gst-150-bce` | BOSCH GST 150 BCE | Bosch GST 150 BCE Jigsaw | Bosch PRO GST 150 BCE Jigsaw | BOSCH → Bosch; add the noun |
| `cricut-maker-3` | Cricut Maker® 3 | Cricut Maker 3 |  | drop ® |
| `dewalt-screwdriver-bit-set` | DEWALT Screwdriver Bit Set | DeWalt Screwdriver Bit Set |  | DEWALT → DeWalt |
| `dremel-workstation-220` | DREMEL Workstation 220 | Dremel Workstation 220 | Dremel 220-01 WorkStation | DREMEL → Dremel |
| `drill-master-heat-gun` | Drill master Heat Gun | Drill Master Heat Gun | Drill Master 1500 Watt Dual Temperature Heat Gun | “Drill master” → “Drill Master” |
| `heat-gun-truepower-drillmaster` | Heat Gun (TruePower / DrillMaster) | Drill Master Heat Gun (TruePower) | Drill Master 96289 Dual Temperature Heat Gun | brand first; “DrillMaster” → “Drill Master” |
| `festool-ps-300-eq-plus-trion-jigsaw` | FESTOOL PS 300 EQ-PLUS TRION JIGSAW | Festool PS 300 EQ-Plus Trion Jigsaw | Festool PS 300 EQ-Plus TRION Pendulum Jigsaw | FESTOOL / all caps → normal casing |
| `form-2` | Form 2 | Formlabs Form 2 |  | add the brand |
| `form-4` | Form 4 | Formlabs Form 4 |  | add the brand |
| `form-cure` | Form Cure | Formlabs Form Cure | Formlabs Form Cure V2 | add the brand |
| `form-wash` | Form Wash | Formlabs Form Wash |  | add the brand |
| `fulton-hose-ring-clamp` | FULTON Hose Ring Clamp | Fulton Hose Ring Clamp |  | FULTON → Fulton |
| `gopro-7-hero-black` | GoPro 7 Hero Black | GoPro HERO7 Black |  | the product's own spelling |
| `kootans-spokeshave-planer` | KOOTANS Spokeshave Planer | Kootans Spokeshave |  | KOOTANS → Kootans; it is a spokeshave, not a planer |
| `makita-plunge-base` | MAKITA Plunge Base | Makita Plunge Base |  | MAKITA → Makita |
| `marvey-hotwire-foam-cutter` | Marvey Hotwire Foam Cutter | Marvy Hotwire Foam Cutter | Marvy Uchida Super Hotwire Foam Cutter | Marvey → Marvy (Marvy Uchida) |
| `oscilloscope-textronix` | Oscilloscope Textronix | Tektronix Oscilloscope |  | Textronix → Tektronix, brand first (model not in the record) |
| `peachtree-woodworking-supply-pvc-hose` | PEACHTREE WOODWORKING SUPPLY PVC Hose | Peachtree PVC Dust Collection Hose |  | PEACHTREE WOODWORKING SUPPLY → Peachtree; say what the hose is for |
| `plunge-cut-track-saw-ts-55-req-f-plus` | Plunge Cut Track Saw TS 55 REQ-F-Plus | Festool TS 55 Track Saw | Festool TS 55 REQ-F-Plus Plunge Cut Track Saw | add the brand; model detail moves to the official name |
| `powertec-hose-coupler-70136` | POWERTEC Cone Reducer | Powertec Cone Reducer |  | POWERTEC → Powertec |
| `ryobi-drill-press` | RYOBI Drill Press | Ryobi Drill Press | RYOBI DP103L 10 in. Drill Press | RYOBI → Ryobi |
| `ryobi-nail-gun` | RYOBI Nail Gun | Ryobi Nail Gun |  | RYOBI → Ryobi |
| `ryobi-pcl235-one-18v-drill-driver` | RYOBI Impact Driver | Ryobi Impact Driver |  | RYOBI → Ryobi |
| `ryobi-vacuum-cleaner-p7131` | RYOBI Hand Vacuum | Ryobi Hand Vacuum |  | RYOBI → Ryobi |
| `skil-multi-detail-sander` | SKIL Multi - Detail Sander | SKIL Multi-Detail Sander | SKIL 1.2 Amp Multi-Sander (SR232301) | “Multi - Detail” → “Multi-Detail” |
| `stanley-coping-saw` | STANLEY Coping Saw | Stanley Coping Saw |  | STANLEY → Stanley |
| `stanley-saw-15-206` | STANLEY Wallboard Saw | Stanley Wallboard Saw |  | STANLEY → Stanley |
| `suizan-dozuki-dovetail-saw` | SUIZAN Dozuki Dovetail Saw | Suizan Dozuki Dovetail Saw | SUIZAN Dozuki Dovetail Saw SDE-002 | SUIZAN → Suizan |
| `suizan-replacement-blade` | SUIZAN Replacement Blade | Suizan Dozuki Replacement Blade |  | SUIZAN → Suizan; say which saw it fits |
| `tripod-with-adapter` | Tripod with adapter | Tripod with Adapter |  | title case |
| `wazer-waterjet-pro` | WAZER - Waterjet Pro | WAZER Pro Waterjet |  | drop the “ - ”; the maker styles its name WAZER |

## 3. Unit labels (`renames.json` › `units`)

| Tool | Before | After | Why |
|---|---|---|---|
| `airaj-hacksaw` | AIRAJ HackSaw #1 | AIRAJ Hacksaw #1 | casing / match the tool's name |
| `aoyue-int-2703a` | AOYUE Int 2703A+ #1 | Aoyue Soldering Station #1 | casing / match the tool's name |
| `bosch-gst-150-bce` | BOSCH GST 150 BCE #1 | Bosch Jigsaw #1 | casing / match the tool's name |
| `brother-compact-monochrome-laser-printer` | Brother Compact Monochrome #1 | Brother Laser Printer #1 | truncated label |
| `cricut-maker-3` | Cricut Maker® 3 #1 | Cricut Maker 3 #1 | drop ® |
| `dewalt-dcb107-12v-20v-max-lithium-ion-charger` | DEWALT DCB107 12V/20V #1 | DeWalt Charger #1 | casing / match the tool's name |
| `dewalt-orbital-sander-dwe6421` | DEWALT Sander #1 | DeWalt Sander #1 | casing / match the tool's name |
| `dewalt-orbital-sander-dwe6421` | DEWALT Sander #2 | DeWalt Sander #2 | casing / match the tool's name |
| `dewalt-screwdriver-bit-set` | DEWALT Screwdriver Bit Set #1 | DeWalt Bit Set #1 | casing / match the tool's name |
| `dremel-workstation-220` | DREMEL Workstation 220 #1 | Dremel Workstation #1 | casing / match the tool's name |
| `drill-master-heat-gun` | Drill master Heat Gun #1 | Drill Master Heat Gun #1 | casing / match the tool's name |
| `festool-ps-300-eq-plus-trion-jigsaw` | FESTOOL PS 300 #1 | Festool Jigsaw #1 | casing / match the tool's name |
| `fulton-hose-ring-clamp` | FULTON Hose Ring Clamp #1 | Fulton Hose Clamp #1 | casing / match the tool's name |
| `hakko-fx-888d` | HAKKO #1 | Hakko #1 | casing / match the tool's name |
| `hakko-fx-888d` | HAKKO #2 | Hakko #2 | casing / match the tool's name |
| `hakko-fx-888d` | HAKKO #3 | Hakko #3 | casing / match the tool's name |
| `heat-gun-truepower-drillmaster` | Heat Gun (TruePower #1 | TruePower Heat Gun #1 | truncated label |
| `hi-spec-16-piece-metal-hand-needle-files-tool-set-kit` | Hi-Spec 16 Piece #1 | Hi-Spec File Set #1 | truncated label |
| `hp-sprout-j4w72aa-aba` | HP Sprout (J4W72AA#ABA) #1 | HP Sprout #1 | casing / match the tool's name |
| `kootans-spokeshave-planer` | KOOTANS Spokeshave Planer #1 | Kootans Spokeshave #1 | casing / match the tool's name |
| `makita-plunge-base` | MAKITA Plunge Base #1 | Makita Plunge Base #1 | casing / match the tool's name |
| `marples-mps10189-japanese-style-pull-saw` | Marples MPS10189 Japanese #1 | Marples Pull Saw #1 | truncated label |
| `marvey-hotwire-foam-cutter` | Marvey Hotwire Foam Cutter #1 | Marvy Foam Cutter #1 | casing / match the tool's name |
| `oscilloscope-textronix` | Oscilloscope Textronix #1 | Tektronix Oscilloscope #1 | casing / match the tool's name |
| `peachtree-woodworking-supply-pvc-hose` | PEACHTREE WOODWORKING SUPPLY #1 | Peachtree Dust Hose #1 | truncated label |
| `plunge-cut-track-saw-ts-55-req-f-plus` | Plunge Cut Track #1 | Festool Track Saw #1 | truncated label |
| `powertec-hose-coupler-70136` | POWERTEC Hose Coupler (70136) #1 | Powertec Cone Reducer #1 | casing / match the tool's name |
| `ryobi-nail-gun` | RYOBI Nail Gun #1 | Ryobi Nail Gun #1 | casing / match the tool's name |
| `ryobi-one-18v-lithium-ion-1-5-ah-battery-pbp002` | RYOBI ONE+ 18V #1 | Ryobi 1.5Ah Battery #1 | four tools shared the label “RYOBI ONE+ 18V #1” |
| `ryobi-one-18v-lithium-ion-3-0-ah-battery-p103` | RYOBI ONE+ 18V #1 | Ryobi 3Ah Battery #1 | four tools shared the label “RYOBI ONE+ 18V #1” |
| `ryobi-one-18v-lithium-ion-4-ah-battery-pbp004` | RYOBI ONE+ 18V #1 | Ryobi 4Ah Battery #1 | four tools shared the label “RYOBI ONE+ 18V #1” |
| `ryobi-one-18v-lithium-ion-charger-pcg002` | RYOBI ONE+ 18V #1 | Ryobi ONE+ Charger #1 | four tools shared the label “RYOBI ONE+ 18V #1” |
| `ryobi-p117-dual-chemistry-12v-18v-battery-charger-replacement` | RYOBI P117 Dual #1 | Ryobi Dual-Chemistry Charger #1 | truncated label |
| `ryobi-p209d-drill-driver` | RYOBI P209D #1 | Ryobi Drill Driver #1 | casing / match the tool's name |
| `ryobi-p322-brad-nailer` | RYOBI P322 Brad Nailer #1 | Ryobi Brad Nailer #1 | casing / match the tool's name |
| `ryobi-p593-18-volt-one-lithium-ion-cordless-pvc-and-pex-cutter` | RYOBI P593 18-Volt #1 | Ryobi PVC Cutter #1 | truncated label |
| `ryobi-pcl235-one-18v-drill-driver` | RYOBI Drill #1 | Ryobi Impact Driver #1 | casing / match the tool's name |
| `ryobi-vacuum-cleaner-p7131` | RYOBI Vacuum Cleaner P7131 #1 | Ryobi Hand Vacuum #1 | casing / match the tool's name |
| `skil-multi-detail-sander` | SKIL Multi - Detail Sander #1 | SKIL Detail Sander #1 | casing / match the tool's name |
| `spear-jackson-traditional-brass-back-tenon-saw-9550b` | SPEAR & JACKSON #1 | Spear & Jackson Tenon Saw #1 | casing / match the tool's name |
| `stanley-1-12-137-62-low-angle-sweetheart-jack-plane` | Stanley 1-12-137 62-Low #1 | Stanley Jack Plane #1 | truncated label |
| `stanley-20-221-10-inch-12-points-per-inch-sharptooth-mini-utility-saw` | STANLEY 20-221 10-Inch #1 | Stanley Mini Utility Saw #1 | truncated label |
| `stanley-20-807-10-inch-mini-hack-light-duty-utility-saw` | STANLEY 20-807 10-Inch #1 | Stanley Mini Hacksaw #1 | truncated label |
| `stanley-coping-saw` | STANLEY Coping Saw #1 | Stanley Coping Saw #1 | casing / match the tool's name |
| `stanley-hand-planer-contractor-grade-low-angle` | STANLEY Hand Planer, #1 | Stanley Block Plane #1 | truncated label |
| `stanley-heavy-duty-extreme-staple-gun-tr150` | STANLEY Heavy Duty #1 | Stanley Staple Gun #1 | casing / match the tool's name |
| `stanley-saw-15-206` | STANLEY Saw 15-206 #1 | Stanley Wallboard Saw #1 | casing / match the tool's name |
| `stanley-sharptooth-heavy-duty-saw-15-087` | STANLEY SharpTooth Heavy #1 | Stanley Short Cut Saw #1 | truncated label |
| `suizan-dozuki-dovetail-saw` | SUIZAN Dozuki Dovetail Saw #1 | Suizan Dozuki Saw #1 | casing / match the tool's name |
| `suizan-replacement-blade` | SUIZAN Replacement Blade #1 | Suizan Replacement Blade #1 | casing / match the tool's name |
| `woodworking-tools-storage-bench` | Woodworking Tools & #1 | Woodworking Bench #1 | truncated label |

## 4. Tags (`tags-remove.json`)

Removed: search-engine spam (shopping and search queries — *deal price*, *refurbished*, *review*, *harbor freight*, *manual pdf* — and model-number variants of the tool's own name) and tags that describe another machine. Kept: materials, processes and features a student would search for (the laser cutters', Form Wash's and the printers' tags are topic words, not spam, and stay).

| Tool | Before → after | Removed | Added | Why |
|---|---|---|---|---|
| `bambu-lab-x1-carbon-combo-3d-printer` | 14 → 13 | prusa i3 mk3s+ |  | wrong tool: describes another machine |
| `bosch-gst-150-bce` | 9 → 1 | bosch 0 601 513 000 jigsaw, bosch 0 601 513 070 jigsaw, bosch gst 150 bce bow handle jigsaw, bosch gst 150 bce saw blade & case kit, bosch gst150bce l‑boxx jigsaw, bosch gst 150 bce, bosch jigsaw 780 w gst 150 bce, gst 150 bce cutting depth 150 mm wood, gst150bce professional jigsaw | jigsaw | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `cowryman-router-plane` | 10 → 5 | cowryman router plane, cowryman tool, cowryman wood plane, precision woodworking plane, woodworking router plane |  | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `dewalt-drill-dcd777c2` | 10 → 1 | dcd777c2 2‑battery drill set, dcd777c2 cordless drill, dcd777c2 drill, dcd777c2 power drill, dewalt 20v max drill, dewalt compact drill driver, dewalt dcd777c2, dewalt dcd777c2 drill kit, dewalt drill driver 20v, dewalt lithium-ion drill | drill driver | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `dewalt-orbital-sander-dwe6421` | 30 → 2 | 12000 opm dwe6421, 3.0 amp dwe6421, 5 inch random orbit sander dwe6421, 5″ random orbit sander dwe6421, corded random orbit sander dewalt, counterweight design reduces vibration dwe6421, dewalt dwe6421, dewalt random orbit sander 5 inch corded, dust-sealed switch dwe6421, dwe-6421, dwe6421, dwe6421 deal price, dwe6421 dust bag, dwe6421 dust port dwv010 dwv012 compatibility, dwe6421 hook & loop pad, dwe6421 manual pdf, dwe6421 parts list, dwe6421 pros cons, dwe6421 random orbit, dwe6421 refurbished, dwe6421 review, dwe6421 sander, dwe6421 sanding disc, dwe6421 used, dwe6421 vacuum adaptor 1-1/4 inch, dwe6421k, dwe6423, one-hand locking dust bag dwe6421, shorter height closer to work piece dwe6421 | random orbit sander | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `dremel-3000` | 13 → 6 | dremel 3000, dremel 3000 accessories, dremel 3000 attachments, dremel 3000 carving, dremel 3000 cutting, dremel 3000 diy tool, dremel 3000 engraving, dremel 3000 hobby tool, dremel 3000 kit, dremel 3000 polishing, dremel 3000 rotary tool, dremel 3000 sanding, dremel 3000 variable speed | rotary tool, carving, cutting, engraving, polishing, sanding | search-engine spam: a shopping/search query or a model-number variant of the tool's own name (the useful words are kept without the brand prefix) |
| `drill-master-heat-gun` | 10 → 1 | drill master electric heat gun, drill master heat gun, drill master heat gun 1500w, drill master heat gun harbor freight, drill master heat gun manual, drill master heat gun model 96289, drill master heat gun parts, drill master heat gun replacement, drill master heat gun troubleshooting, drill master hot air gun | hot air gun | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `festool-ps-300-eq-plus-trion-jigsaw` | 8 → 2 | festool 576041 jigsaw, festool ps 300 eq plus trion, festool ps 300 eq‑plus pendulum jigsaw, festool ps300 eq plus barrel grip jigsaw, festool ps 300 eq‑plus, festool trion ps 300 eq plus systainer kit, festool trion ps 300 eq‑plus, ps 300 eq‑plus jigsaw | jigsaw, pendulum jigsaw | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `heat-gun-truepower-drillmaster` | 13 → 1 | drill master 1500 watt heat gun, drill master dual temperature heat gun, drill master heat gun, drill master heat gun amazon, drill master heat gun ebay, drill master heat gun harbor freight, drill master heat gun manual, drill master heat gun model 96289, drill master heat gun parts, drill master heat gun replacement, drill master heat gun reviews, drill master heat gun settings, harbor freight heat gun | hot air gun | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `makita-rt0701c` | 12 → 2 | 000 rpm, 000-30, makita 1-1/4 hp compact router rt0701c, makita rt0701c, makita rt0701c fixed base router, rt0701c 1/4-inch collet router, rt0701c 10, rt0701c accessories, rt0701c compact router, rt0701c part number, rt0701c review, rt0701c variable-speed router | compact router, variable-speed router | search-engine spam: a shopping/search query or a model-number variant of the tool's own name; also fragments of a split spec (“000 rpm”, “000-30”, “rt0701c 10”) |
| `mayku-form-box-vacuum-former` | 23 → 5 | desktop vacuum forming machine, diy vacuum former, mayku desktop vacuum former, mayku formbox, mayku formbox accessories, mayku formbox machine, mayku formbox mold maker, mayku formbox price, mayku formbox reviews, mayku formbox sheets, mayku formbox specifications, mayku formbox thermoformer, mayku formbox vacuum former, mayku forming sheets, mayku vacuum former, plastic vacuum former, tabletop vacuum former, vacuum forming kit |  | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `plunge-cut-track-saw-ts-55-req-f-plus` | 19 → 3 | festool plunge saw maintenance, festool ts 55 req blade, festool ts 55 req manual download, festool ts 55 req operation, festool ts 55 req price, festool ts 55 req review, festool ts 55 req-f-plus, festool ts 55 specifications, festool ts 55 troubleshooting, ts 55 req accessories, ts 55 req manual, ts 55 req parts, ts 55 req safety features, ts 55 req setup, ts 55 req user guide, ts 55 req-f-plus pdf |  | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `rockwell-bladerunner-x2-rk7323` | 27 → 25 | sla cutting, post-processing |  | wrong tool: describes another machine (resin printing terms on a saw) |
| `ryobi-nail-gun` | 10 → 2 | ryobi 18‑gauge brad nailer, ryobi airstrike brad nailer depth adjustment, ryobi brad nailer 18v kit, ryobi brad nailer compatible nails, ryobi brad nailer parts list p322, ryobi cordless brad nailer 18 gauge, ryobi one+ 18v airstrike brad nailer, ryobi one+ nail gun finish nailer 16 gauge vs 18 gauge, ryobi p321 p322 review, ryobi p322 nail gun | brad nailer, 18 gauge | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `ryobi-vacuum-cleaner-p7131` | 12 → 2 | ryobi 18v hand vacuum p7131, ryobi 18v one+ hand vac, ryobi p7131, ryobi p7131 accessories, ryobi p7131 cordless vacuum, ryobi p7131 crevice tool, ryobi p7131 hand vacuum, ryobi p7131 parts, ryobi p7131 replacement filter, ryobi p7131 review, ryobi p7131 specifications, ryobi p7131 vacuum manual | hand vacuum, cordless vacuum | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `stanley-20-221-10-inch-12-points-per-inch-sharptooth-mini-utility-saw` | 15 → 3 | stanley 10-inch hand saw, stanley 12 tpi saw, stanley 20-221 saw, stanley 20-221 sharptooth 10-inch, stanley 20-221 sharptooth replacement, stanley compact hand saw, stanley fine cut saw, stanley general purpose saw, stanley precision saw, stanley sharptooth mini utility saw, stanley small utility saw, stanley trimming saw, stanley utility saw for woodworking, stanley wood and plastic saw | fine cut saw, trimming saw | search-engine spam: a shopping/search query or a model-number variant of the tool's own name |
| `ultimaker-s5` | 14 → 13 | ultimaker s5 extended |  | wrong tool: describes another machine (the lab's S5 is not the Extended) |
| `wen-benchtop-belt-and-disc-sander-6502t` | 10 → 2 | makita 1‑1/4 hp compact router rt0701c, makita rt0701c, makita rt0701c fixed‑base router, rt0701c 10 000‑30 000 rpm, rt0701c accessories, rt0701c compact router, rt0701c part number, rt0701c review, rt0701c variable‑speed router, rt0701c ¼‑inch collet router | belt sander, disc sander | wrong tool: describes another machine: all ten tags are the Makita RT0701C router's |

## 5. Starter questions (`starter-questions.json`)

Only for tools with none. Three each — operate, debug, create where it makes sense — written from the tool's record (description, materials, resource titles), ≤ 80 characters, no PPE or safety claims.

| Tool | Operate | Debug | Create |
|---|---|---|---|
| AIRAJ HackSaw | How do I adjust the blade tension? | What if the blade keeps bending or snapping? | Can I cut metal and plastic with it? |
| Aoyue Soldering Station | How do I set up the hot-air gun to remove a part? | Why won't my solder melt onto the joint? | Can I desolder a whole component with this? |
| Apple Pencil | How do I connect it to the iPad? | Why isn't the iPad picking up my strokes? | Can I sketch concept drawings with it? |
| Bambu Lab X1-Carbon Combo 3D Printer | How do I start my first print? | Why is my print not sticking to the bed? | Can I print carbon-fiber parts with it? |
| Othermill Pro | How do I mill my first circuit board? | What if my traces come out rough or uneven? | Can I make small parts from aluminum or brass? |
| Bantam Tools Desktop CNC Milling Machine | How do I set up my first milling job? | What if the cut doesn't come out the right depth? | What can I make in aluminum with it? |
| BGA Rework Station | How do I remove a chip from a circuit board? | Why won't the chip come off the board? | Which boards and parts can I repair with it? |
| Bofa Fume Extractor | How do I turn it on with the laser cutter? | What if the laser smell doesn't go away? | Which machines does it work with? |
| BOSCH GST 150 BCE | How do I change the blade? | What if the blade keeps wandering off the line? | Can I cut curves and bevels in chipboard? |
| Brother Compact Monochrome Laser Printer | How do I print double-sided? | What if the paper jams? | Can I print on envelopes or labels? |
| Cowryman Router Plane | How do I set the cutting depth? | Why is the bottom of my groove uneven? | What can I clean up with it in joinery? |
| Creality Ender-3 V3 3D Printer | How do I start my first print? | Why is my print not sticking to the bed? | Can I print flexible parts with TPU? |
| Cricut Easy Press 3 | How do I press a design onto a T-shirt? | Why is my iron-on peeling off after pressing? | What can I put designs on besides shirts? |
| Cricut Maker® 3 | How do I cut my first vinyl decal? | Why isn't it cutting all the way through? | Can I cut leather or balsa wood with it? |
| DeWalt Charger | How do I charge a battery with it? | What if the charger light blinks? | Which batteries can I charge with it? |
| DeWalt Drill/Driver | How do I change the drill bit? | Why does the screw keep stripping? | Can I drill holes in steel with it? |
| DeWalt Orbital Sander | How do I attach a new sanding disc? | Why am I getting swirl marks? | Can I prep a painted surface with it? |
| DEWALT Screwdriver Bit Set | Which bit do I use for a Torx screw? | How do I put a bit in the drill? | Can I use these bits in an impact driver? |
| Dremel 3000 | How do I swap attachments? | Why is my cut burning the material? | Can I engrave glass with it? |
| DREMEL Workstation 220 | How do I mount my rotary tool on it? | Why isn't my hole coming out straight? | Can I drill holes at an angle with it? |
| Drill master Heat Gun | How do I pick between the two heat settings? | What if the paint won't lift off? | Can I shrink wire wraps with it? |
| Dust Masks | How do I put one on so it fits well? | Which kinds of dust is it made for? | What if it gets dirty during a project? |
| Epilog Helix 24 Laser Cutter | How do I send my design to the laser? | Why didn't the laser cut all the way through? | Can I engrave glass with it? |
| EverSewn Sparrow X2 | How do I thread it for sewing? | Why do my stitches keep bunching up? | Can I embroider my own design onto fabric? |
| Festool Dust Extractor | How do I hook it up to a power tool? | What if the suction gets weak? | Can I use it for wet cleanup too? |
| Festool Bench | How do I clamp my work to the table? | How do I make straight cuts with the guide rail? | What can I use the perforated top for? |
| FESTOOL PS 300 EQ-PLUS TRION JIGSAW | How do I change the blade? | What if my veneer keeps splintering? | Can I make mitre cuts with it? |
| Form 2 | How do I start my first resin print? | Why did my print fail to stick to the platform? | What can I make with resin on it? |
| Form 4 | How do I start my first resin print? | What if my print comes out with missing parts? | Can I make functional parts with it? |
| Form Cure | How do I pick the cure time and temperature? | Why do my parts still feel tacky after curing? | Which resins can I cure in it? |
| Form Wash | How do I wash a print still on the platform? | Why do my parts still feel sticky after washing? | Which washing liquids can I use in it? |
| FULTON Hose Ring Clamp | How do I tighten it onto a hose? | What if the hose keeps slipping off the port? | Which fittings can I join a hose to with it? |
| Glowforge Aura | How do I start my first cut? | Why didn't it cut all the way through? | Can I engrave leather or cork with it? |
| GoPro 7 Hero Black | How do I start recording video? | Why is my footage still shaky? | Can I film underwater with it? |
| Hakko Soldering Station | How do I set the iron temperature? | Why won't solder stick to my tip? | Can I use lead-free solder with it? |
| Heat Gun (TruePower / DrillMaster) | Which heat setting should I start with? | What if the plastic starts to scorch? | Can I bend PVC or PLA with it? |
| Hercules Sanding Sheets | Which grit should I start with? | Can I use these on a power sander? | Can I sand plastic or metal with them? |
| Hi-Spec Metal File Set | Which file should I use for small details? | How do I deburr a metal edge? | Can I shape plastic parts with these? |
| HP Sprout | How do I capture an object in 3D? | What if my scan comes out incomplete? | What can I make with my scans in Sprout Workspace? |
| Husky Coping Saw | How do I swap or re-angle the blade? | What if the blade keeps popping out? | Can I cut tight curves in wood with it? |
| Infrared IC Heater | How do I solder a small PCB in it? | Why didn't my solder joints melt fully? | Can I replace components on a board with it? |
| iPad 6th generation | How do I get started with a 3D scanning app? | Why isn't the Apple Pencil working with it? | What can I design on it? |
| KOOTANS Spokeshave Planer | How do I adjust the blade depth? | Why is it chattering instead of cutting smoothly? | Can I shape curved parts like chair legs? |
| Label Maker AC Adapter | How do I plug it into the label maker? | What if the label maker won't power on? | Can I use it instead of batteries? |
| MAKITA Plunge Base | How do I fit the router into the plunge base? | How do I set the plunge depth? | Can I cut mortises or inlays with it? |
| Makita Compact Router | How do I pick the right speed? | Why is my cut burning the wood? | Can I route acrylic or MDF with it? |
| Marples Japanese Pull Saw | How do I make a flush cut on a dowel? | What if the saw keeps binding in the cut? | Can I cut dovetails with it? |
| Marvey Hotwire Foam Cutter | How do I cut a shape out of foam? | Why is it tearing the foam instead of cutting? | Can I cut felt with it? |
| Matter and Form 3D Scanner | How do I scan my first object? | What if my scan has holes or missing parts? | Can I 3D print what I scan? |
| Mayku Form Box Vacuum Former | How do I make my first mold? | Why isn't the sheet forming tight around my part? | What can I make with the clear sheets? |
| Meta Quest 2 VR Headset | How do I set it up for the first time? | What if the controllers stop tracking? | Can I play PC VR games with it? |
| Original Prusa i3 MK3S+ Enclosure Bundle | How do I start my first print? | Why is my print warping or lifting? | Can I print nylon or ASA in it? |
| Oscilloscope Textronix | How do I see a signal on the screen for the first time? | What if my waveform won't hold still on the screen? | What can I measure in my circuit with this? |
| PEACHTREE WOODWORKING SUPPLY PVC Hose | How do I hook this hose up to a machine? | Which machines can I connect it to? | What if the suction feels weak through the hose? |
| Plunge Cut Track Saw TS 55 REQ-F-Plus | How do I set up the guide rail for my first cut? | Why is my cut splintering along the edge? | Can I cut plywood sheets with this? |
| Plywood Stacking Rolling Cart | How do I load sheets onto the cart? | Which materials can I store on it? | Can I use it to move plywood around the lab? |
| POWERTEC Cone Reducer | How do I connect two hoses with this? | Which hose sizes does it join? | How do I switch hoses between tools? |
| Prusa i3 MK3S+ | How do I start my first print? | Why is my print not sticking to the bed? | Can I print flexible parts with this? |
| Rockwell BladeRunner X2 | How do I change the blade? | What if the blade wanders off my line? | Can I cut ceramic tile with it? |
| Roland Camm-1 GS-24 Desktop Vinyl Cutter | How do I load vinyl and start a cut? | Why isn't my vinyl cutting all the way through? | Can I make heat-transfer designs for a shirt? |
| RYOBI Drill Press | How do I set the depth for repeatable holes? | Why does my bit wander when I start a hole? | Can I drill metal with this? |
| RYOBI Nail Gun | How do I load nails into it? | What if a nail jams in the nailer? | What can I build with a brad nailer? |
| Ryobi ONE+ 1.5Ah Battery | Which tools does this battery fit? | How do I charge this battery? | How do I check how much charge is left? |
| Ryobi ONE+ 3Ah Battery | Which tools does this battery fit? | How do I charge this battery? | Why pick this one for overhead work? |
| Ryobi ONE+ 4Ah Battery | Which tools does this battery fit? | How do I charge this battery? | How do I check how much charge is left? |
| Ryobi ONE+ Battery Charger | How do I charge a battery with it? | How long does a 1.5 Ah battery take to charge? | What if the charger light doesn't come on? |
| Ryobi Dual-Chemistry Battery Charger | How do I charge a battery with it? | Which battery packs can it charge? | What if my battery won't start charging? |
| Ryobi Drill Driver | How do I switch between drilling and driving screws? | Why do my screws keep stripping? | How do I change the drill bit? |
| Ryobi Hot Glue Gun | How do I load a glue stick? | What if glue drips or strings everywhere? | Which glue sticks fit in it? |
| Ryobi Brad Nailer | How do I load brads into it? | What if a brad jams? | What can I assemble with it? |
| Ryobi PVC and PEX Cutter | How do I make my first cut? | What if my cut comes out crooked? | Can I cut rubber hose with this? |
| RYOBI Impact Driver | How do I set the clutch for driving screws? | Why does it stop turning before the screw is in? | Can I drill into metal with it? |
| RYOBI Hand Vacuum | How do I empty the dust bowl? | Why is the suction getting weaker? | How do I use the crevice tool? |
| Shaper Origin | How do I start my first cut? | What if it loses track of where it is? | Can I make an inlay with this? |
| ShopBot Buddy BT48 | How do I start my first job? | Why is my cut not going all the way through? | Can I cut aluminum with this? |
| Singer Stylist 7258 | How do I thread the machine? | Why do my stitches keep skipping? | How do I make a buttonhole? |
| SKIL Multi - Detail Sander | How do I swap the sanding pads? | Which pad should I use for corners? | Can I sand curved edges with it? |
| SMD Rework Station | How do I remove a surface-mount part? | What if the solder won't melt under the hot air? | How do I set the temperature and airflow? |
| Spear & Jackson Tenon Saw | How do I start a straight cut? | What if my cut keeps drifting off the line? | Can I cut a tenon joint with this? |
| Stanley Sweetheart Jack Plane | How do I set the blade depth? | Why is the plane tearing the wood? | Can I plane end grain with this? |
| Stanley Mini Utility Saw | How do I start a clean cut? | What if the blade binds in the cut? | Can I cut plastic pipe with this? |
| Stanley Mini Hacksaw | How do I change the blade? | What if the blade keeps snagging in metal? | Can I cut PVC pipe with this? |
| STANLEY Coping Saw | How do I change the blade? | How do I make an interior cutout? | Can I cut plastic with it? |
| Stanley Block Plane | How do I adjust the blade? | Why is it chattering on end grain? | How do I chamfer an edge with it? |
| Stanley Staple Gun | How do I load staples? | What if a staple jams? | Can I use it to upholster a seat? |
| STANLEY Wallboard Saw | How do I start a plunge cut in the board? | What if the cut edge comes out ragged? | Can I cut an opening in plasterboard? |
| Stanley Short Cut Saw | How do I start a cut? | What if the saw keeps binding? | What can I cut with it? |
| Structure Sensor | How do I connect it to an iPad? | Why is my scan coming out with holes? | What can I scan with it? |
| SUIZAN Dozuki Dovetail Saw | How do I cut with a pull saw? | What if my cut wanders off the line? | Can I make angled cuts for dovetails? |
| SUIZAN Replacement Blade | How do I swap the blade on the saw? | Which saw does this blade fit? | What's this blade best for? |
| Tripod with adapter | How do I mount my phone on it? | Which devices can I attach to it? | Can I use it for 3D scanning? |
| Trotec Speedy 400 | How do I send my first job to the laser? | Why isn't the laser cutting all the way through? | Can I engrave glass with this? |
| Ultimaker 3 | How do I start my first print? | Why is my print not sticking to the plate? | Can I print with dissolvable PVA supports? |
| Ultimaker 3 Extended | How do I start my first print? | What if one nozzle stops printing mid-job? | Can I print in two materials at once? |
| Ultimaker Metal Expansion Kit | How do I get started printing metal parts? | Which printer does this kit work with? | What can I make in stainless steel? |
| Ultimaker S5 | How do I start my first print? | Why is my print not sticking to the plate? | Can I print with two materials at once? |
| Ultimaker S5 Air Manager | How do I use it with the S5? | What's the filter for? | Which materials can I print with it on? |
| Valley Craft A Frame Bin Cart | How do I find where parts are kept? | How do I move the cart around the lab? | What can I store in the bins? |
| WAZER - Waterjet Pro | How do I start my first cut? | Why isn't it cutting all the way through? | Can I cut glass artwork with this? |
| Weller Soldering Station | How do I set the iron's temperature? | Why won't the solder stick to the tip? | Can I repair a broken electronics board? |
| WEN Belt and Disc Sander | How do I sand an angled edge? | What if the belt slides off to one side? | What can I smooth with the belt vs the disc? |
| WEN Dust Collector | How do I connect it to a tool? | Why is the suction getting weaker? | How do I empty the collection bag? |
| Woodworking Tools & Storage Bench | Which hand tools are kept here? | How do I use the bench for assembly? | Can I clamp my work to the bench? |

(Where a kind does not fit — batteries, hoses, carts — the column holds the substitute; `kinds` in the JSON says which.)

## 6. Tracking parameters (`urls-clean.json`)

`?utm_source=chatgpt.com` off stored links. PR #102 adds `npm run resources:clean-urls` and strips these on every future write; this bundle does the same four links so it stands alone, and either one run first leaves the other nothing to do.

| Tool | Resource | Before | After |
|---|---|---|---|
| `bambu-lab-x1-carbon-combo-3d-printer` | Bambu Lab X1-Carbon Combo 3D Printer - SOP | https://cdn1.bambulab.com/documentation/quick-start-e254168f69145/X1C/English%20version-Quick%20Start%20Guide%20for%20X1-Carbon.pdf?utm_source=chatgpt.com | https://cdn1.bambulab.com/documentation/quick-start-e254168f69145/X1C/English%20version-Quick%20Start%20Guide%20for%20X1-Carbon.pdf |
| `plunge-cut-track-saw-ts-55-req-f-plus` | Plunge Cut Track Saw TS 55 REQ-F-Plus - SOP | https://www.festoolusa.com/-/media/tts/fcp/festool-usa/downloads/manuals/festool-ts55req-supplemental-manual.pdf?utm_source=chatgpt.com | https://www.festoolusa.com/-/media/tts/fcp/festool-usa/downloads/manuals/festool-ts55req-supplemental-manual.pdf |
| `ultimaker-s5` | Ultimaker S5 - SOP | https://um-support-files.ultimaker.com/manuals/user-manual/S5-Pro-Bundle/EN-Pro%20Bundle-User%20manual-V2.2.pdf?utm_source=chatgpt.com | https://um-support-files.ultimaker.com/manuals/user-manual/S5-Pro-Bundle/EN-Pro%20Bundle-User%20manual-V2.2.pdf |
| `dewalt-drill-dcd777c2` | DeWalt Drill (DCD777C2) - SOP | https://www.dewalt.ca/GLOBALBOM/QU/DCD777C2/1/Instruction_Manual/EN/NA136155_DCD777_DCD778_T1_NA.pdf?utm_source=chatgpt.com | https://www.dewalt.ca/GLOBALBOM/QU/DCD777C2/1/Instruction_Manual/EN/NA136155_DCD777_DCD778_T1_NA.pdf |

## Noticed, not changed

- `ryobi-nail-gun` (“Ryobi Nail Gun”) and `ryobi-p322-brad-nailer` look like the same 18-gauge brad nailer — possibly a duplicate record.
- `drill-master-heat-gun` and `heat-gun-truepower-drillmaster` both describe a Drill Master dual-temperature heat gun (the second names model 96289) — possibly a duplicate record.
- `ryobi-pcl235-one-18v-drill-driver` is named *Impact Driver* (official name PCL235B impact driver) but its description says drill/driver.
- All the FDM printers carry one shared materials tag list (Ultimaker material names such as *breakaway*, *cpe+*) — kept, but not machine-specific.
- `festool-575267…` and `peachtree…` link to retailer listings rather than the maker's page.
