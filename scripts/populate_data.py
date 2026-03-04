#!/usr/bin/env python3
"""
Consolidated data pipeline for MakerLab Tools.

Merges the functionality of:
  - prepare_tools_v2.py   (Excel -> tools_v2_data.json)
  - setup_tools_v2.py     (JSON  -> AirTable Categories/Locations/Tools)
  - populate_units.py     (create Unit records for multi-unit tools)
  - backfill_qr_codes.py  (assign qr_code_id to units missing one)

Stages (each can run independently via CLI flags):
  --prepare   Read Excel, clean data, output data/tools_v2_data.json  (default)
  --populate  Read tools_v2_data.json, create AirTable records
  --units     Create Unit records for tools with multiple physical units
  --qr        Backfill qr_code_ids on units missing them
  --all       Run all stages in order

Usage:
  python populate_data.py                # runs --prepare
  python populate_data.py --all          # runs all four stages
  python populate_data.py --populate     # populate AirTable only
  python populate_data.py --units --qr   # units + qr backfill

Requires: openpyxl (for --prepare stage only)
"""

import argparse
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request

# ── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
ENV_PATH = os.path.join(SCRIPT_DIR, ".env")
DATA_JSON = os.path.join(DATA_DIR, "tools_v2_data.json")
FORM_XLSX = os.path.join(
    DATA_DIR,
    "MakerLAB Tools & Equipment Meta Data Generator (Responses).xlsx",
)

API_URL = "https://api.airtable.com/v0"

# ═════════════════════════════════════════════════════════════════════════════
# STAGE 1: PREPARE  --  Excel -> tools_v2_data.json
# ═════════════════════════════════════════════════════════════════════════════

# ── Category taxonomy ────────────────────────────────────────────────────────

CATEGORIES = {
    "3D Printing": [
        "FDM Printer", "SLA Printer", "Post-Processing",
        "Vacuum Former", "3D Scanner", "Accessory",
    ],
    "Laser Cutting": ["Laser Cutter", "Fume Extractor"],
    "CNC & Digital Fabrication": [
        "CNC Mill", "Vinyl Cutter", "Waterjet", "Workstation",
    ],
    "Woodworking": [
        "Hand Saw", "Power Saw", "Sander", "Drill/Driver", "Plane",
        "Router", "Chisel/Scraper", "Clamp", "Nailer/Stapler",
        "Measuring", "General Hand Tool", "Accessory",
    ],
    "Electronics": [
        "Soldering", "Rework Station", "Test Equipment", "Workstation",
    ],
    "Sewing & Textiles": [
        "Sewing Machine", "Embroidery Machine", "Heat Press",
    ],
    "Scanning & VR": [
        "VR Headset", "Camera", "3D Scanner", "Tablet/Accessory",
    ],
    "Printing & Large Format": [
        "Plotter", "Laser Printer", "Label Maker",
    ],
    "Safety & Infrastructure": [
        "PPE", "Dust Extraction", "Fume Extraction",
        "Air Compressor", "Hose/Accessory",
    ],
}

# ── Location taxonomy ────────────────────────────────────────────────────────

LOCATIONS = {
    "Studio 101": [
        "3D Printing Zone", "Electronics Bench", "Sewing Area",
        "Scanning/VR Area", "Common Space",
    ],
    "Studio 101A": ["Woodshop"],
    "Studio 101C": ["Laser Room"],
}

# ── Category mapping rules  (regex on tool name -> (group, sub)) ─────────────

CATEGORY_RULES = [
    # 3D Printing
    (r"Ultimaker.*Expansion|Ultimaker.*Air Manager|Original Prusa.*Enclosure",
     ("3D Printing", "Accessory")),
    (r"Ultimaker|Prusa|Bambu",
     ("3D Printing", "FDM Printer")),
    (r"Form [24]$|Form [24] ",
     ("3D Printing", "SLA Printer")),
    (r"Form Cure|Form Wash",
     ("3D Printing", "Post-Processing")),
    (r"Mayku|Formbox|FormBox",
     ("3D Printing", "Vacuum Former")),
    (r"Matter and Form.*Scanner|Structure Sensor",
     ("3D Printing", "3D Scanner")),

    # Laser Cutting
    (r"Epilog|Trotec",
     ("Laser Cutting", "Laser Cutter")),
    (r"Bofa|Fume Extractor",
     ("Laser Cutting", "Fume Extractor")),

    # CNC & Digital Fabrication
    (r"Bantam|Shopbot|ShopBot",
     ("CNC & Digital Fabrication", "CNC Mill")),
    (r"Shaper Origin",
     ("CNC & Digital Fabrication", "CNC Mill")),
    (r"Shaper Workstation",
     ("CNC & Digital Fabrication", "Workstation")),
    (r"Roland.*Vinyl|Cricut Maker",
     ("CNC & Digital Fabrication", "Vinyl Cutter")),
    (r"WAZER",
     ("CNC & Digital Fabrication", "Waterjet")),

    # Electronics
    (r"Soldering|HAKKO|AOYUE|Weller",
     ("Electronics", "Soldering")),
    (r"BGA.*Rework|SMD.*Rework|Rework Station",
     ("Electronics", "Rework Station")),
    (r"Oscilloscope",
     ("Electronics", "Test Equipment")),
    (r"DREMEL Workstation",
     ("Electronics", "Workstation")),
    (r"Infrared IC Heater",
     ("Electronics", "Rework Station")),

    # Sewing & Textiles
    (r"EverSewn",
     ("Sewing & Textiles", "Embroidery Machine")),
    (r"Singer",
     ("Sewing & Textiles", "Sewing Machine")),
    (r"Cricut Easy Press",
     ("Sewing & Textiles", "Heat Press")),

    # Scanning & VR
    (r"Meta Quest",
     ("Scanning & VR", "VR Headset")),
    (r"GoPro",
     ("Scanning & VR", "Camera")),
    (r"HP Sprout|3D Scanner",
     ("Scanning & VR", "3D Scanner")),
    (r"iPad|Apple Pencil|Tripod",
     ("Scanning & VR", "Tablet/Accessory")),

    # Printing & Large Format
    (r"DesignJet|Plotter",
     ("Printing & Large Format", "Plotter")),
    (r"Brother.*Laser|B&W Laser|Laser Printer",
     ("Printing & Large Format", "Laser Printer")),
    (r"Label Maker",
     ("Printing & Large Format", "Label Maker")),

    # Safety & Infrastructure
    (r"Dust Mask",
     ("Safety & Infrastructure", "PPE")),
    (r"CALIFORNIA AIR|Compressor",
     ("Safety & Infrastructure", "Air Compressor")),
    (r"Dust Extractor|Dust Collector|FESTOOL CT|Mobile Dust",
     ("Safety & Infrastructure", "Dust Extraction")),
    (r"Hose Coupler|Hose Ring|PVC Hose",
     ("Safety & Infrastructure", "Hose/Accessory")),

    # Woodworking - specific tool types  (order matters: specific before general)
    (r"Nail Gun|Nailer|Brad Nailer|Staple Gun|Stapler",
     ("Woodworking", "Nailer/Stapler")),
    (r"Bandsaw|Band Saw|Back Saw|Dozuki|AIRAJ.*Saw|Hack.*Saw|Utility Saw|"
     r"STANLEY.*Saw|Coping Saw|Tenon Saw|Pull Saw|SPEAR.*Saw|Marples.*Saw",
     ("Woodworking", "Hand Saw")),
    (r"Jigsaw|Jig Saw|Circular Saw|Miter Saw|SKIL.*Saw|RYOBI.*Saw|"
     r"Track Saw|FESTOOL.*PS|BOSCH GST|BladeRunner|Hotwire.*Cutter|Foam Cutter|Pex Cutter",
     ("Woodworking", "Power Saw")),
    (r"Orbital Sander|Belt.*Sander|Disc Sander|WEN.*Sander|"
     r"Sander|Sanding Sheet",
     ("Woodworking", "Sander")),
    (r"Drill Press|Drill.*Driver|Drill \(",
     ("Woodworking", "Drill/Driver")),
    (r"Bench Plane|Block Plane|Smoothing Plane|Router Plane|"
     r"Spokeshave|Jack Plane|Hand Planer|Plunge Ba",
     ("Woodworking", "Plane")),
    (r"RT0701C|Compact Router|Plunge.*Base|Router(?!.*Plane)",
     ("Woodworking", "Router")),
    (r"Chisel|Scraper|Rasp|File(?:s| Set)",
     ("Woodworking", "Chisel/Scraper")),
    (r"Clamp|Quick-Grip",
     ("Woodworking", "Clamp")),
    (r"Measuring Tape|Tape Measure",
     ("Woodworking", "Measuring")),
    (r"Snips|Shears|Pliers|Wrench|Screwdriver|Hex Key|Allen|Socket.*Bit|"
     r"HUSKY|Bit Set|Heat Gun|Dremel [0-9]|Mallet|Dead Blow|Hammer|"
     r"Glue Gun|Hot Glue|Vacuum Cleaner",
     ("Woodworking", "General Hand Tool")),

    # Woodworking accessories
    (r"Battery|Charger|DCB|Replacement Blade|Sanding Sheet",
     ("Woodworking", "Accessory")),

    # Catch-all for remaining woodworking items
    (r"Festool Bench|Storage Bench|Rolling Cart|A Frame.*Cart|Valley Craft|"
     r"Woodworking Tools|Plywood.*Cart",
     ("CNC & Digital Fabrication", "Workstation")),
]

# ── Location mapping ─────────────────────────────────────────────────────────

LOCATION_MAP = {
    "1. Studio101 - All Purpose Open Space": ("Studio 101", "Common Space"),
    "2. Studio101- 3D Printing Zone": ("Studio 101", "3D Printing Zone"),
    "3. Studio101 A - Woodshop": ("Studio 101A", "Woodshop"),
    "4. Studio101 C - Laser Room": ("Studio 101C", "Laser Room"),
    "Wood Shop 101A": ("Studio 101A", "Woodshop"),
    "Woodworking Zone": ("Studio 101A", "Woodshop"),
    "3D Scanning": ("Studio 101", "Scanning/VR Area"),
    "Sewing/Embroidery Zone": ("Studio 101", "Sewing Area"),
    "Common Purpose Space": ("Studio 101", "Common Space"),
}

LOCATION_FALLBACK = {
    "3D Printing": ("Studio 101", "3D Printing Zone"),
    "Laser Cutting": ("Studio 101C", "Laser Room"),
    "CNC & Digital Fabrication": ("Studio 101A", "Woodshop"),
    "Woodworking": ("Studio 101A", "Woodshop"),
    "Electronics": ("Studio 101", "Electronics Bench"),
    "Sewing & Textiles": ("Studio 101", "Sewing Area"),
    "Scanning & VR": ("Studio 101", "Scanning/VR Area"),
    "Printing & Large Format": ("Studio 101", "Common Space"),
    "Safety & Infrastructure": ("Studio 101A", "Woodshop"),
}

# ── Name fixes ───────────────────────────────────────────────────────────────

NAME_FIXES = {
    "MAKITA  Plunge Bass": "MAKITA Plunge Base",
    "SUIZAN  Dozuki Dovetail Saw": "SUIZAN Dozuki Dovetail Saw",
    "EverSewn Sparrow X2 Sewing & Embroidery Machine,":
        "EverSewn Sparrow X2 Sewing & Embroidery Machine",
    "RYOBI P322 ONE+ HP 18V 18-Gauge Brushless Cordless Airstrike Brad Nailer":
        "RYOBI P322 Brad Nailer",
}

# ── Materials normalization ──────────────────────────────────────────────────

MATERIALS_NORMALIZE = {
    "wood": "Wood",
    "pla": "PLA",
    "abs": "ABS",
    "petg": "PETG",
    "tpu": "TPU",
    "nylon": "Nylon",
    "cpe": "CPE",
    "mdf": "MDF",
    "acrylic": "Acrylic",
    "plywood": "Plywood",
    "aluminum": "Aluminum",
    "plastic": "Plastic",
    "vinyl": "Vinyl",
    "leather": "Leather",
    "fabric": "Fabric",
    "resin": "Resin",
    "glass": "Glass",
    "steel": "Steel",
    "copper": "Copper",
    "brass": "Brass",
    "foam": "Foam",
    "cardboard": "Cardboard",
    "paper": "Paper",
    "hardwood": "Hardwood",
    "softwood": "Softwood",
    "laminate": "Laminate",
    "polycarbonate": "Polycarbonate",
    "composite": "Composite",
    "pvc": "PVC",
    "rubber": "Rubber",
    "ceramic": "Ceramic",
    "wax": "Wax",
    "denim": "Denim",
    "silk": "Silk",
    "canvas": "Canvas",
    "polyester": "Polyester",
    "felt": "Felt",
    "cotton": "Cotton",
}

_MAT_ALIASES = {
    "polylactic acid": "PLA",
    "acrylonitrile butadiene styrene": "ABS",
    "polyethylene terephthalate glycol": "PETG",
    "thermoplastic polyurethane": "TPU",
    "medium density fiberboard": "MDF",
    "aluminium": "Aluminum",
    "softwoods": "Softwood",
    "hardwoods": "Hardwood",
    "laminates": "Laminate",
    "plastics": "Plastic",
    "metals": "Steel",
    "metal": "Steel",
    "composites": "Composite",
    "ceramics": "Ceramic",
    "tile": "Ceramic",
    "stone": "Ceramic",
    "particle board": "MDF",
    "chipboard": "MDF",
    "pine": "Softwood",
    "cedar": "Softwood",
    "fir": "Softwood",
    "spruce": "Softwood",
    "oak": "Hardwood",
    "maple": "Hardwood",
    "cherry": "Hardwood",
    "walnut": "Hardwood",
    "birch": "Hardwood",
    "varnish": "Laminate",
}

# ── PPE normalization ────────────────────────────────────────────────────────

PPE_NORMALIZE = {
    "glasses": "Safety Glasses",
    "safety glasses": "Safety Glasses",
    "mask": "Dust Mask",
    "dust mask": "Dust Mask",
    "dust masks": "Dust Mask",
    "gloves": "Gloves",
}

# ── Description overrides ────────────────────────────────────────────────────

DESCRIPTION_OVERRIDES = {
    "Epilog Helix 24 laser (8000 Laser System)":
        "40W Epilog Helix 24x18 CO2 laser cutter and engraver for precision cutting "
        "and raster engraving on wood, acrylic, cardboard, fabric, and paper.",

    "Bofa AD500 Fume Extractor":
        "Industrial fume extraction unit rated at approximately 324 CFM (550 m3/hr). "
        "Features HEPA/gas filtration, automatic flow control, real-time airflow "
        "monitoring, and remote diagnostics. Paired with the laser cutters in the Laser Room.",

    "Trotec Speedy 400, 80w":
        "80W Trotec Speedy 400 CO2 laser cutter with a 40x24-inch bed for cutting "
        "and engraving wood, acrylic, cardboard, fabric, and paper.",

    "Dremel 3000":
        "The Dremel 3000 is a versatile corded rotary tool used for cutting, sanding, "
        "grinding, polishing, carving, and engraving on materials like wood, metal, "
        "plastic, and tile. It features variable speeds (5,000-35,000 RPM), a comfortable "
        "soft-grip design, and an EZ Twist nose cap for easy accessory changes.",

    "Cowryman Router Plane":
        "The Cowryman router plane is a woodworking hand tool used for smoothing and "
        "leveling grooves, dados, and mortises. It has an adjustable blade and flat sole "
        "for precise, controlled cutting, making it ideal for clean, accurate joints "
        "and inlays.",

    "WAZER - Waterjet Pro":
        "Desktop waterjet cutter with a 12x18-inch cutting area. Cuts aluminum up to 1 inch "
        "and stainless steel up to 0.375 inches. Runs on filtered tap water with a 2.1 kW "
        "hydraulic pump. Continuous cutting time up to 90 minutes per session.",

    "Festool 575267 Dust Extractor CT Midi Hepa":
        "HEPA-rated mobile dust extractor from Festool. Designed for connection to power "
        "tools for on-tool dust collection. Features automatic tool-start and adjustable "
        "suction.",

    "WEN Woodworking Dust Collector (DC3401)":
        "Shop dust collection system for capturing airborne sawdust and wood chips. "
        "Connects to stationary woodworking equipment via 4-inch hose ports.",

    "Rockwell BladeRunner X2 (RK7323)":
        "Compact portable tabletop saw using T-shank blades for cutting wood, ceramic tile, "
        "PVC, aluminum, and steel. Features adjustable depth, rip fence, and miter gauge.",
}

# ── Description templates ────────────────────────────────────────────────────

DESCRIPTION_TEMPLATES = {
    # 3D Printing
    "FDM Printer":
        "{name} FDM 3D printer for additive manufacturing with thermoplastic filaments "
        "including {materials_or_default}.",
    "SLA Printer":
        "{name} SLA 3D printer for high-resolution resin-based additive manufacturing.",
    "Post-Processing":
        "{name} post-processing station for SLA 3D prints. "
        "Used for washing or curing resin parts after printing.",
    "Vacuum Former":
        "{name} desktop vacuum former for thermoforming plastic sheets over custom molds.",
    "3D Scanner":
        "{name} 3D scanner for capturing physical objects as digital 3D models.",

    # Laser Cutting
    "Laser Cutter":
        "{name} CO2 laser cutter and engraver for precision cutting and engraving on "
        "{materials_or_default}.",
    "Fume Extractor":
        "{name} fume extraction unit for filtering hazardous particles and gases "
        "produced during laser cutting.",

    # CNC & Digital Fabrication
    "CNC Mill":
        "{name} CNC milling machine for subtractive fabrication of "
        "{materials_or_default}.",
    "Vinyl Cutter":
        "{name} for cutting vinyl, paper, and thin sheet materials from digital designs.",
    "Waterjet":
        "{name} waterjet cutter for cutting metal, stone, glass, and other hard materials "
        "using a high-pressure water and abrasive stream.",
    "Workstation":
        "{name} workstation providing a dedicated workspace for fabrication tasks.",

    # Woodworking
    "Hand Saw":
        "{name} hand saw for precision cutting of wood and similar materials.",
    "Power Saw":
        "{name} power saw for cutting {materials_or_default}.",
    "Sander":
        "{name} sander for smoothing and finishing wood and other surfaces.",
    "Drill/Driver":
        "{name} for drilling holes and driving fasteners in {materials_or_default}.",
    "Plane":
        "{name} hand plane for smoothing, flattening, and shaping wood surfaces.",
    "Router":
        "{name} compact router for edge profiling, trimming, and groove cutting "
        "in {materials_or_default}.",
    "Chisel/Scraper":
        "{name} for shaping, smoothing, and finishing wood and metal surfaces.",
    "Clamp":
        "{name} clamp for securing workpieces during gluing, cutting, or assembly.",
    "Nailer/Stapler":
        "{name} for driving nails or staples into wood, trim, and similar materials.",
    "Measuring":
        "{name} measuring tool for accurate layout and dimensioning.",
    "General Hand Tool":
        "{name} general-purpose hand tool for workshop tasks.",

    # Electronics
    "Soldering":
        "{name} soldering station for joining electronic components using solder.",
    "Rework Station":
        "{name} rework station for removing and replacing surface-mount and "
        "through-hole electronic components.",
    "Test Equipment":
        "{name} test instrument for measuring and analyzing electronic signals.",

    # Sewing & Textiles
    "Sewing Machine":
        "{name} sewing machine for stitching fabric, leather, and textiles.",
    "Embroidery Machine":
        "{name} sewing and embroidery machine for stitching and decorative embroidery "
        "on fabric and textiles.",
    "Heat Press":
        "{name} heat press for transferring designs onto fabric and other substrates.",

    # Scanning & VR
    "VR Headset":
        "{name} virtual reality headset for immersive 3D visualization and interactive "
        "design review.",
    "Camera":
        "{name} action camera for recording video of projects and processes.",
    "Tablet/Accessory":
        "{name} tablet accessory for digital design, 3D scanning, and project documentation.",

    # Printing & Large Format
    "Plotter":
        "{name} large-format plotter for printing posters, architectural drawings, "
        "and signage.",
    "Laser Printer":
        "{name} monochrome laser printer for fast, high-quality document output.",
    "Label Maker":
        "{name} label maker for creating adhesive labels for organization and signage.",

    # Safety & Infrastructure
    "PPE":
        "{name} personal protective equipment for workshop safety.",
    "Dust Extraction":
        "{name} dust extraction system for capturing airborne dust and particles "
        "during woodworking and fabrication.",
    "Fume Extraction":
        "{name} fume extraction system for filtering hazardous fumes and particulates.",
    "Air Compressor":
        "{name} air compressor providing compressed air for pneumatic tools and cleaning.",
    "Hose/Accessory":
        "{name} hose or coupler accessory for dust collection and air systems.",

    # Accessory (shared between categories)
    "Accessory":
        "{name} accessory for expanding the capabilities of the parent tool or system.",
}

# ── Generic/stub descriptions to ignore ──────────────────────────────────────

_GENERIC_DESCRIPTIONS = {
    "hand tool", "power tool", "sander", "router", "cutter",
    "nail gun", "heat gun", "power saw", "belt and disc sander",
    "3d printer accessories", "vacuum former", "vacuum cleaner",
    "dust masks", "dust extractor", "dust collector", "sanding sheet",
    "none", "n/a", "",
}

# ── Tags to exclude (brand-only or noise) ────────────────────────────────────

_TAG_BLACKLIST_PATTERNS = [
    r"^(ryobi|dewalt|makita|stanley|bosch|festool|wen|dremel|husky|"
    r"spear.*jackson|cowryman|suizan|marples|airaj|hi-spec|hercules|"
    r"powertec|peachtree|fulton|wazer|shopbot|bantam|shaper|roland|"
    r"cricut|singer|eversewn|mayku|formlabs|ultimaker|prusa|bambu|"
    r"bofa|trotec|epilog|hakko|aoyue|weller|gopro|meta|apple|hp|"
    r"brother|skil|rockwell|marvey|infrared|donaldson|valley craft)$",
    r"^\s*$",
    r"^n/?a$",
    r"^\d+$",
]

# ═════════════════════════════════════════════════════════════════════════════
# STAGE 3: UNITS  --  Unit records for multi-unit tools
# ═════════════════════════════════════════════════════════════════════════════

# Tools with multiple physical units, mapped by tool record ID.
# Format: (tool_record_id, [(label, status, condition), ...])
UNIT_DATA = [
    # 3D Printers -- multiple units of same model
    ("reckY0HP8yVmwrUXW", [  # Prusa i3 MK3S+
        ("Prusa MK3S+ #1", "Available", "Good"),
        ("Prusa MK3S+ #2", "Available", "Good"),
        ("Prusa MK3S+ #3", "Available", "Excellent"),
        ("Prusa MK3S+ #4", "Under Maintenance", "Needs Repair"),
    ]),
    ("recsxQuhH0IMDWEHp", [  # Original Prusa i3 MK3S+ Enclosure Bundle
        ("Prusa Enclosure #1", "Available", "Good"),
        ("Prusa Enclosure #2", "Available", "Good"),
    ]),
    ("recohXvrLHiv7X6Ih", [  # Bambu Lab X1-Carbon Combo
        ("Bambu X1C #1", "Available", "Excellent"),
        ("Bambu X1C #2", "Available", "Excellent"),
    ]),
    ("rec1j0T4xi6SpUn56", [  # Ultimaker 3
        ("Ultimaker 3 #1", "Available", "Fair"),
        ("Ultimaker 3 #2", "Out of Service", "Needs Repair"),
    ]),
    ("rec3KXyzVg0kOQin7", [  # Ultimaker 3 Extended
        ("Ultimaker 3 Ext #1", "Available", "Good"),
    ]),
    ("reccMLQgu2VOcSdbg", [  # Ultimaker S5
        ("Ultimaker S5 #1", "Available", "Good"),
        ("Ultimaker S5 #2", "Available", "Good"),
    ]),

    # Resin printers + post-processing
    ("recpd1jcl1c0hTh8z", [  # Form 2
        ("Form 2 #1", "Available", "Fair"),
    ]),
    ("recrmUPR7GbcCFSZ5", [  # Form 4
        ("Form 4 #1", "Available", "Excellent"),
    ]),
    ("rec3apbYmyQoyVYC9", [  # Form Cure
        ("Form Cure #1", "Available", "Good"),
    ]),
    ("recyNHGSOCpMJMUNe", [  # Form Wash
        ("Form Wash #1", "Available", "Good"),
    ]),

    # Laser cutters
    ("recAmVALSf183SXup", [  # Epilog Helix 24
        ("Epilog Helix #1", "Available", "Good"),
    ]),
    ("recw66bovAeSgd09D", [  # Trotec Speedy 400
        ("Trotec 400 #1", "Available", "Excellent"),
    ]),

    # CNC
    ("reczn3ybnevPnpDvm", [  # Shopbot Buddy
        ("Shopbot #1", "Available", "Good"),
    ]),
    ("rechvVjk7bdZQuff7", [  # Bantam Tools Desktop CNC
        ("Bantam CNC #1", "Available", "Good"),
    ]),
    ("recYGf0rpxIYiuogy", [  # Bantam Desktop PCB Milling
        ("Bantam PCB Mill #1", "Available", "Good"),
    ]),

    # Soldering stations -- multiple units
    ("recMFrmUHCY5WF6eI", [  # HAKKO FX-888D
        ("HAKKO #1", "Available", "Good"),
        ("HAKKO #2", "Available", "Good"),
        ("HAKKO #3", "Available", "Fair"),
    ]),
    ("recNSXSVww31GdV0L", [  # Weller WESD51
        ("Weller #1", "Available", "Good"),
        ("Weller #2", "Available", "Good"),
    ]),

    # Sewing machines
    ("recPSJN9Rb3VLEVUX", [  # EverSewn Sparrow X2
        ("EverSewn #1", "Available", "Good"),
    ]),
    ("rec0MBFevqtHoo7os", [  # Singer Stylist 7258
        ("Singer #1", "Available", "Good"),
        ("Singer #2", "Available", "Fair"),
    ]),

    # Vinyl cutter
    ("rec8ChrPgMEiqQn3u", [  # Roland Camm-1 GS-24
        ("Roland Vinyl Cutter #1", "Available", "Good"),
    ]),

    # Waterjet
    ("rec23OWkkd6j4j0I2", [  # WAZER
        ("WAZER #1", "Available", "Good"),
    ]),

    # Vacuum former
    ("recFmh9YWY0IDbi2n", [  # Mayku Form Box
        ("Mayku FormBox #1", "Available", "Good"),
    ]),

    # Sanders
    ("recTS5EgPruymDfXt", [  # DEWALT Orbital Sander
        ("DEWALT Sander #1", "Available", "Good"),
        ("DEWALT Sander #2", "Available", "Good"),
    ]),
    ("recZe9u41jiXaw8G2", [  # WEN Belt and Disc Sander
        ("WEN Sander #1", "Available", "Good"),
        ("WEN Sander #2", "Under Maintenance", "Fair"),
    ]),

    # Drills
    ("recKWWKzrkk1U0JJo", [  # DeWalt Drill DCD777C2
        ("DeWalt Drill #1", "Available", "Good"),
        ("DeWalt Drill #2", "Available", "Good"),
    ]),
    ("recjKz1fM10JzrGI9", [  # RYOBI PCL235
        ("RYOBI Drill #1", "Available", "Good"),
    ]),
    ("rec1XuXG8kIeQuYtA", [  # RYOBI P209D
        ("RYOBI P209D #1", "Available", "Fair"),
    ]),

    # Dremel
    ("rec8lADY1sC4WoqEU", [  # Dremel 3000
        ("Dremel #1", "Available", "Good"),
        ("Dremel #2", "Available", "Good"),
    ]),

    # Routers
    ("reczRJVdQgPJAlBVL", [  # MAKITA RT0701C
        ("Makita Router #1", "Available", "Good"),
        ("Makita Router #2", "Available", "Good"),
    ]),

    # Shaper Origin
    ("recAL3eOuvoF1CiFf", [  # Shaper Origin
        ("Shaper Origin #1", "Available", "Excellent"),
    ]),

    # Drill press
    ("recfb2iVhBPzTFO3f", [  # RYOBI Drill Press
        ("Drill Press #1", "Available", "Good"),
    ]),

    # Hot glue gun
    ("reclX5WrI29WK37yi", [  # RYOBI Hot Glue Gun
        ("Hot Glue Gun #1", "Available", "Good"),
        ("Hot Glue Gun #2", "Available", "Good"),
    ]),

    # Dust collection
    ("recWSQOw6k1Pc3udN", [  # Festool Dust Extractor
        ("Festool Dust Extractor #1", "Available", "Good"),
    ]),
    ("recTfX7Aqi3koULwe", [  # WEN Dust Collector
        ("WEN Dust Collector #1", "Available", "Good"),
    ]),

    # iPad / Scanner / VR
    ("rec5Q4zdolQmqkQmP", [  # iPad 6th gen
        ("iPad #1", "Available", "Good"),
        ("iPad #2", "Available", "Fair"),
    ]),
    ("rec3Yjqf4qOUTMHWi", [  # Meta Quest 2
        ("Quest 2 #1", "Available", "Good"),
        ("Quest 2 #2", "Available", "Good"),
    ]),
    ("recNXk4vNqNPzQ7Sx", [  # GoPro 7
        ("GoPro #1", "Available", "Good"),
    ]),
]


# ═════════════════════════════════════════════════════════════════════════════
# SHARED HELPERS
# ═════════════════════════════════════════════════════════════════════════════


def load_env():
    """Load key=value pairs from the .env file in the scripts/ directory."""
    config = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    key, val = line.split("=", 1)
                    config[key.strip()] = val.strip()
    return config


def get_airtable_config():
    """Return (token, base_id) from .env or environment, or exit with error."""
    config = load_env()
    token = config.get("AIRTABLE_API_KEY") or os.environ.get("AIRTABLE_API_KEY")
    base_id = config.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLE_BASE_ID")

    if not token:
        print("Error: AIRTABLE_API_KEY not found in .env or environment.")
        sys.exit(1)
    if not base_id:
        print("Error: AIRTABLE_BASE_ID not found in .env or environment.")
        sys.exit(1)

    return token, base_id


def get_table_id(env_config, env_key, fallback_env_key=None):
    """Resolve a table ID from .env config, falling back to os.environ."""
    val = env_config.get(env_key)
    if val:
        return val
    if fallback_env_key:
        val = env_config.get(fallback_env_key)
        if val:
            return val
    val = os.environ.get(env_key)
    if val:
        return val
    return None


def api_request(method, path, token, data=None, max_retries=5):
    """Make an AirTable API request with automatic retry on rate-limit (429)."""
    url = f"{API_URL}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = e.headers.get("Retry-After", "2")
                delay = int(retry_after)
                print(f"  Rate limited, waiting {delay}s... (attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
                continue
            error_body = e.read().decode() if e.fp else ""
            print(f"API Error {e.code}: {error_body}")
            raise
    print("Error: max retries exceeded on rate-limited request.")
    sys.exit(1)


def fetch_all_records(token, base_id, table_id):
    """Fetch all records from a table, handling pagination."""
    records = []
    offset = None
    while True:
        path = f"/{base_id}/{table_id}"
        if offset:
            path += f"?offset={offset}"
        result = api_request("GET", path, token)
        records.extend(result.get("records", []))
        offset = result.get("offset")
        if not offset:
            break
        time.sleep(0.25)
    return records


def batch_create_records(token, base_id, table_id, records, label="records"):
    """Create records in batches of 10 with rate limiting.

    Each element of `records` should be a dict of field values (not wrapped
    in {"fields": ...} -- this function wraps them).
    """
    created = 0
    for i in range(0, len(records), 10):
        batch = records[i:i + 10]
        payload = {"records": [{"fields": r} for r in batch]}
        result = api_request("POST", f"/{base_id}/{table_id}", token, payload)
        created += len(result.get("records", []))
        batch_num = (i // 10) + 1
        total_batches = (len(records) + 9) // 10
        print(f"  Batch {batch_num}/{total_batches}: {len(result.get('records', []))} {label}")
        time.sleep(0.25)
    return created


def batch_update_records(token, base_id, table_id, updates, label="records"):
    """Update records in batches of 10. Each element must have 'id' and 'fields'."""
    updated = 0
    for i in range(0, len(updates), 10):
        batch = updates[i:i + 10]
        api_request("PATCH", f"/{base_id}/{table_id}", token, {"records": batch})
        updated += len(batch)
        time.sleep(0.25)
    return updated


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 1 HELPERS: Cleaning and normalization
# ═════════════════════════════════════════════════════════════════════════════


def clean_text(val):
    """Return cleaned text or None."""
    if val is None:
        return None
    val = str(val).strip()
    if val.lower() in ("none", "n/a", "", "none ", "n/a "):
        return None
    return val


def clean_url(val):
    """Return a valid URL or None."""
    if not val:
        return None
    val = str(val).strip()
    if val.lower() in ("none", "n/a", "", "none "):
        return None
    if val.startswith("http://") or val.startswith("https://"):
        return val
    if val.startswith("www."):
        return f"https://{val}"
    if "docs.google.com" in val or "drive.google.com" in val:
        return f"https://{val}"
    return None


def clean_bool(val):
    """Convert a YES/NO/None string to a boolean."""
    if not val:
        return False
    val = str(val).strip().upper()
    return val == "YES"


def classify_tool(name):
    """Apply CATEGORY_RULES to determine (group, sub) for a tool name."""
    for pattern, category in CATEGORY_RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return category
    return None


def resolve_location(raw_loc, category_group):
    """Map a raw location string to (room, zone)."""
    if raw_loc:
        loc = str(raw_loc).strip()
        if loc in LOCATION_MAP:
            return LOCATION_MAP[loc]
    # Fallback by category group
    if category_group and category_group in LOCATION_FALLBACK:
        return LOCATION_FALLBACK[category_group]
    return ("Studio 101", "Common Space")


def parse_materials(raw):
    """Parse a comma-separated materials string into a list of canonical names."""
    if not raw:
        return []
    raw = str(raw).strip()
    if raw.lower() in ("n/a", "none", ""):
        return []

    result = set()
    # Split on commas, semicolons, or " and "
    parts = re.split(r"[,;]\s*|\s+and\s+", raw)
    for part in parts:
        # Strip parenthetical explanations  e.g. "PLA (Polylactic Acid)"
        part = re.sub(r"\s*\(.*?\)", "", part).strip().rstrip(".,;")
        if not part:
            continue
        lower = part.lower()

        # Try direct match
        if lower in MATERIALS_NORMALIZE:
            result.add(MATERIALS_NORMALIZE[lower])
            continue

        # Try alias
        if lower in _MAT_ALIASES:
            result.add(_MAT_ALIASES[lower])
            continue

        # Try substring match for multi-word entries
        matched = False
        for key, canon in MATERIALS_NORMALIZE.items():
            if key in lower:
                result.add(canon)
                matched = True
                break
        if matched:
            continue

        for key, canon in _MAT_ALIASES.items():
            if key in lower:
                result.add(canon)
                matched = True
                break
        if matched:
            continue

        # Skip things like "Laserable", "Standard", "Tough", etc.
        if lower in ("laserable", "standard", "tough", "flexible",
                      "castable", "dental", "water-washable",
                      "high-temperature", "clear", "n/a", "none"):
            continue

        # If it looks like a real material word, keep as title-case
        if len(part) > 2 and part[0].isalpha():
            # Skip if it looks like a brand name or model number
            if not re.search(r"\d{3,}", part):
                result.add(part.title())

    return sorted(result)


def parse_ppe(raw):
    """Parse PPE string into a list of canonical PPE items."""
    if not raw:
        return []
    raw = str(raw).strip()
    if raw.lower() in ("none", "n/a", ""):
        return []

    result = set()
    parts = re.split(r"[,;]\s*", raw)
    for part in parts:
        lower = part.strip().lower()
        if lower in PPE_NORMALIZE:
            result.add(PPE_NORMALIZE[lower])
    return sorted(result)


def parse_tags(raw):
    """Parse comma-separated tags, normalize, and filter."""
    if not raw:
        return []
    raw = str(raw).strip()
    if raw.lower() in ("n/a", "none", ""):
        return []

    result = set()
    parts = re.split(r"[,;]\s*", raw)
    for part in parts:
        tag = part.strip().rstrip(".").lower()
        if not tag or len(tag) < 2:
            continue
        if tag in ("n/a", "none"):
            continue

        # Skip blacklisted tags
        skip = False
        for pat in _TAG_BLACKLIST_PATTERNS:
            if re.match(pat, tag, re.IGNORECASE):
                skip = True
                break
        if skip:
            continue

        # Skip very long tags (likely descriptions not tags)
        if len(tag) > 60:
            continue

        # Normalize: lowercase, trim
        result.add(tag)

    return sorted(result)


def generate_description(name, category_group, category_sub, materials_list):
    """Generate a 1-2 sentence description from metadata."""
    # Check overrides first
    if name in DESCRIPTION_OVERRIDES:
        return DESCRIPTION_OVERRIDES[name]

    template = DESCRIPTION_TEMPLATES.get(category_sub)
    if not template:
        return f"{name} tool available in the MakerLAB."

    # Build a materials snippet
    if materials_list:
        materials_or_default = ", ".join(materials_list[:5])
    else:
        # Reasonable defaults by subcategory
        defaults = {
            "FDM Printer": "PLA, ABS, PETG, and TPU",
            "Laser Cutter": "wood, acrylic, cardboard, and fabric",
            "CNC Mill": "wood, plastic, and soft metals",
            "Power Saw": "wood, plywood, and MDF",
            "Router": "wood, plywood, and laminate",
            "Drill/Driver": "wood, metal, and plastic",
            "Vinyl Cutter": "vinyl and thin sheet materials",
        }
        materials_or_default = defaults.get(category_sub, "various materials")

    return template.format(
        name=name,
        materials_or_default=materials_or_default,
    )


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 1: --prepare
# ═════════════════════════════════════════════════════════════════════════════


def run_prepare():
    """Read the Excel file, clean/normalize data, and output tools_v2_data.json."""
    try:
        import openpyxl
    except ImportError:
        print("Error: openpyxl is required for --prepare. Install with: pip install openpyxl")
        sys.exit(1)

    if not os.path.exists(FORM_XLSX):
        print(f"Error: Excel file not found at {FORM_XLSX}")
        sys.exit(1)

    print(f"[prepare] Reading {FORM_XLSX} ...")
    wb = openpyxl.load_workbook(FORM_XLSX, read_only=True)
    ws = wb["Form Responses 1"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"  {len(rows)} raw rows")

    # ── Pass 1: Parse and deduplicate ────────────────────────────────────

    tools_by_name = {}

    for r in rows:
        r = list(r) + [None] * (17 - len(r))

        name = clean_text(r[1])
        if not name:
            continue

        # Apply name fixes
        name = NAME_FIXES.get(name, name)
        # Collapse multiple spaces
        name = re.sub(r"\s{2,}", " ", name).strip()

        raw_desc = clean_text(r[5])
        raw_loc = clean_text(r[3])
        raw_materials = clean_text(r[7])
        raw_ppe = clean_text(r[14])
        raw_tags = clean_text(r[16])
        raw_auth = clean_text(r[8])
        raw_training = clean_text(r[9])
        raw_restrictions = clean_text(r[10])
        raw_safety_url = clean_url(r[11])
        raw_sop_url = clean_url(r[12])
        raw_estop = clean_text(r[13])
        raw_video_url = clean_url(r[15])
        raw_map_tag = clean_text(r[4])

        entry = {
            "raw_name": name,
            "raw_desc": raw_desc,
            "raw_loc": raw_loc,
            "raw_materials": raw_materials,
            "raw_ppe": raw_ppe,
            "raw_tags": raw_tags,
            "raw_auth": raw_auth,
            "raw_training": raw_training,
            "raw_restrictions": raw_restrictions,
            "safety_doc_url": raw_safety_url,
            "sop_url": raw_sop_url,
            "raw_estop": raw_estop,
            "video_url": raw_video_url,
            "raw_map_tag": raw_map_tag,
        }

        if name in tools_by_name:
            # Merge: prefer the entry with more data (keep URLs and materials
            # from whichever row has them)
            existing = tools_by_name[name]
            for key in entry:
                if entry[key] and not existing.get(key):
                    existing[key] = entry[key]
            # For descriptions, prefer longer one
            if entry["raw_desc"] and (
                not existing["raw_desc"]
                or len(str(entry["raw_desc"])) > len(str(existing["raw_desc"]))
            ):
                existing["raw_desc"] = entry["raw_desc"]
        else:
            tools_by_name[name] = entry

    print(f"  {len(tools_by_name)} unique tools after dedup")

    # ── Pass 2: Classify, clean, and generate descriptions ───────────────

    all_tags = set()
    all_materials = set()
    tools = []
    unclassified = []

    for name, raw in sorted(tools_by_name.items()):
        # Category
        cat = classify_tool(name)
        if cat is None:
            unclassified.append(name)
            continue
        category_group, category_sub = cat

        # Location
        loc_room, loc_zone = resolve_location(raw["raw_loc"], category_group)

        # Materials
        materials = parse_materials(raw["raw_materials"])
        all_materials.update(materials)

        # PPE
        ppe = parse_ppe(raw["raw_ppe"])

        # Tags
        tags = parse_tags(raw["raw_tags"])
        all_tags.update(tags)

        # Description
        raw_desc = raw["raw_desc"]
        desc_reviewed = False
        if raw_desc and raw_desc.lower() not in _GENERIC_DESCRIPTIONS and len(raw_desc) > 30:
            if name in DESCRIPTION_OVERRIDES:
                description = DESCRIPTION_OVERRIDES[name]
            else:
                description = raw_desc
            desc_reviewed = True
        else:
            description = generate_description(name, category_group, category_sub, materials)

        # Boolean fields
        authorized_only = clean_bool(raw["raw_auth"])
        training_text = clean_text(raw["raw_training"])
        training_required = bool(
            training_text
            and training_text.lower() not in ("none", "n/a", "no")
        )

        # Text fields
        use_restrictions = clean_text(raw["raw_restrictions"])
        if use_restrictions and use_restrictions.lower() in ("n/a", "none"):
            use_restrictions = None
        emergency_stop = clean_text(raw["raw_estop"])
        if emergency_stop and emergency_stop.lower() in ("none", "n/a"):
            emergency_stop = None

        # Map tag
        map_tag = clean_text(raw["raw_map_tag"])
        if map_tag and map_tag.lower() in ("n/a", "none"):
            map_tag = None

        tool = {
            "name": name,
            "description": description,
            "description_reviewed": desc_reviewed,
            "category_group": category_group,
            "category_sub": category_sub,
            "location_room": loc_room,
            "location_zone": loc_zone,
            "materials": materials if materials else None,
            "ppe_required": ppe if ppe else None,
            "tags": tags if tags else None,
            "authorized_only": authorized_only,
            "training_required": training_required,
            "use_restrictions": use_restrictions,
            "emergency_stop": emergency_stop,
            "safety_doc_url": raw.get("safety_doc_url"),
            "sop_url": raw.get("sop_url"),
            "video_url": raw.get("video_url"),
            "map_tag": map_tag,
        }
        tools.append(tool)

    print(f"  {len(tools)} tools classified")
    if unclassified:
        print(f"  {len(unclassified)} unclassified (skipped):")
        for n in unclassified:
            print(f"    - {n}")

    # ── Build vocab lists ────────────────────────────────────────────────

    materials_vocab = sorted(all_materials)
    ppe_vocab = sorted({"Safety Glasses", "Dust Mask", "Gloves"})
    tags_vocab = sorted(all_tags)

    # ── Build output ─────────────────────────────────────────────────────

    output = {
        "categories": CATEGORIES,
        "locations": LOCATIONS,
        "materials_vocab": materials_vocab,
        "ppe_vocab": ppe_vocab,
        "tags_vocab": tags_vocab,
        "tools": tools,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_JSON, "w") as f:
        json.dump(output, f, indent=2)

    # ── Summary statistics ───────────────────────────────────────────────

    print(f"\n[prepare] Wrote {len(tools)} tools to {DATA_JSON}")
    print(f"\nVocabulary sizes:")
    print(f"  Materials:  {len(materials_vocab)}")
    print(f"  PPE:        {len(ppe_vocab)}")
    print(f"  Tags:       {len(tags_vocab)}")

    print(f"\nCategory distribution:")
    cat_counts = {}
    for t in tools:
        key = f"{t['category_group']} > {t['category_sub']}"
        cat_counts[key] = cat_counts.get(key, 0) + 1
    for key in sorted(cat_counts):
        print(f"  {key:45s} {cat_counts[key]:3d}")

    print(f"\nLocation distribution:")
    loc_counts = {}
    for t in tools:
        key = f"{t['location_room']} > {t['location_zone']}"
        loc_counts[key] = loc_counts.get(key, 0) + 1
    for key in sorted(loc_counts):
        print(f"  {key:45s} {loc_counts[key]:3d}")

    print(f"\nField coverage:")
    field_names = [
        "description", "materials", "ppe_required", "tags",
        "safety_doc_url", "sop_url", "video_url",
        "use_restrictions", "emergency_stop", "map_tag",
    ]
    for field in field_names:
        count = sum(1 for t in tools if t.get(field))
        print(f"  {field:25s} {count:3d}/{len(tools)}")

    reviewed = sum(1 for t in tools if t.get("description_reviewed"))
    generated = len(tools) - reviewed
    print(f"\nDescriptions: {reviewed} reviewed, {generated} auto-generated")

    auth_count = sum(1 for t in tools if t.get("authorized_only"))
    train_count = sum(1 for t in tools if t.get("training_required"))
    print(f"Access control: {auth_count} authorized-only, {train_count} training-required")


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 2: --populate
# ═════════════════════════════════════════════════════════════════════════════


def run_populate():
    """Read tools_v2_data.json and populate Categories, Locations, and Tools
    records in AirTable.

    Assumes the tables already exist (created by setup_schema.py). Table IDs
    are read from .env:
      AIRTABLE_TABLE_TOOLS
      AIRTABLE_TABLE_CATEGORIES
      AIRTABLE_TABLE_LOCATIONS
    """
    token, base_id = get_airtable_config()
    env_config = load_env()

    # Resolve table IDs from .env
    tools_table_id = get_table_id(env_config, "AIRTABLE_TABLE_TOOLS")
    categories_table_id = get_table_id(env_config, "AIRTABLE_TABLE_CATEGORIES")
    locations_table_id = get_table_id(env_config, "AIRTABLE_TABLE_LOCATIONS")

    if not tools_table_id:
        print("Error: AIRTABLE_TABLE_TOOLS not set in .env. Run setup_schema.py first.")
        sys.exit(1)
    if not categories_table_id:
        print("Error: AIRTABLE_TABLE_CATEGORIES not set in .env. Run setup_schema.py first.")
        sys.exit(1)
    if not locations_table_id:
        print("Error: AIRTABLE_TABLE_LOCATIONS not set in .env. Run setup_schema.py first.")
        sys.exit(1)

    # Load prepared data
    if not os.path.exists(DATA_JSON):
        print(f"Error: {DATA_JSON} not found. Run --prepare first.")
        sys.exit(1)

    with open(DATA_JSON) as f:
        data = json.load(f)

    categories = data["categories"]
    locations = data["locations"]
    tools = data["tools"]

    print(f"[populate] Using base: {base_id}")
    print(f"  Tables: categories={categories_table_id}, locations={locations_table_id}, tools={tools_table_id}")
    print(f"  Data: {len(tools)} tools, {sum(len(v) for v in categories.values())} categories, "
          f"{sum(len(v) for v in locations.values())} locations")
    print()

    # ── Step 1: Populate Categories ──────────────────────────────────────

    print("[populate] Inserting category records...")
    cat_records = []
    for group in sorted(categories.keys()):
        for sub in sorted(categories[group]):
            cat_records.append({"name": sub, "group": group})

    cat_created = batch_create_records(
        token, base_id, categories_table_id, cat_records, label="categories"
    )
    print(f"  Created {cat_created} category records")

    # Fetch back to build (group, sub) -> record_id mapping
    print("  Fetching category record IDs...")
    all_cat_records = fetch_all_records(token, base_id, categories_table_id)
    cat_map = {}
    for rec in all_cat_records:
        fields = rec["fields"]
        group = fields.get("group")
        name = fields.get("name")
        if group and name:
            cat_map[(group, name)] = rec["id"]
    print(f"  Mapped {len(cat_map)} categories")
    print()

    # ── Step 2: Populate Locations ───────────────────────────────────────

    print("[populate] Inserting location records...")
    loc_records = []
    for room in sorted(locations.keys()):
        for zone in sorted(locations[room]):
            loc_records.append({"name": zone, "room": room})

    loc_created = batch_create_records(
        token, base_id, locations_table_id, loc_records, label="locations"
    )
    print(f"  Created {loc_created} location records")

    # Fetch back to build (room, zone) -> record_id mapping
    print("  Fetching location record IDs...")
    all_loc_records = fetch_all_records(token, base_id, locations_table_id)
    loc_map = {}
    for rec in all_loc_records:
        fields = rec["fields"]
        room = fields.get("room")
        name = fields.get("name")
        if room and name:
            loc_map[(room, name)] = rec["id"]
    print(f"  Mapped {len(loc_map)} locations")
    print()

    # ── Step 3: Import tool records ──────────────────────────────────────

    print(f"[populate] Importing {len(tools)} tools...")
    tool_records = []

    for tool in tools:
        fields = {
            "name": tool["name"],
            "description": tool["description"],
        }

        # Checkbox: description_reviewed (only include if True)
        if tool.get("description_reviewed"):
            fields["description_reviewed"] = True

        # Linked category
        cat_key = (tool["category_group"], tool["category_sub"])
        cat_rec_id = cat_map.get(cat_key)
        if cat_rec_id:
            fields["category"] = [cat_rec_id]
        else:
            print(f"  Warning: no category record for {cat_key} (tool: {tool['name']})")

        # Linked location
        loc_key = (tool["location_room"], tool["location_zone"])
        loc_rec_id = loc_map.get(loc_key)
        if loc_rec_id:
            fields["location"] = [loc_rec_id]
        else:
            print(f"  Warning: no location record for {loc_key} (tool: {tool['name']})")

        # multipleSelects -- values must exactly match vocab
        if tool.get("materials"):
            fields["materials"] = tool["materials"]
        if tool.get("ppe_required"):
            fields["ppe_required"] = tool["ppe_required"]
        if tool.get("tags"):
            fields["tags"] = tool["tags"]

        # Checkboxes: only include if True
        if tool.get("authorized_only"):
            fields["authorized_only"] = True
        if tool.get("training_required"):
            fields["training_required"] = True

        # Optional text fields -- omit if None
        if tool.get("use_restrictions"):
            fields["use_restrictions"] = tool["use_restrictions"]
        if tool.get("emergency_stop"):
            fields["emergency_stop"] = tool["emergency_stop"]

        # Optional URL fields -- omit if None
        if tool.get("safety_doc_url"):
            fields["safety_doc_url"] = tool["safety_doc_url"]
        if tool.get("sop_url"):
            fields["sop_url"] = tool["sop_url"]
        if tool.get("video_url"):
            fields["video_url"] = tool["video_url"]

        # Optional map tag
        if tool.get("map_tag"):
            fields["map_tag"] = tool["map_tag"]

        tool_records.append(fields)

    tools_created = batch_create_records(
        token, base_id, tools_table_id, tool_records, label="tools"
    )

    print()
    print("[populate] Done!")
    print(f"  Categories: {cat_created} records in {categories_table_id}")
    print(f"  Locations:  {loc_created} records in {locations_table_id}")
    print(f"  Tools:      {tools_created} records in {tools_table_id}")
    print(f"  Base URL:   https://airtable.com/{base_id}")


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 3: --units
# ═════════════════════════════════════════════════════════════════════════════


def run_units():
    """Create Unit records for tools with multiple physical units."""
    token, base_id = get_airtable_config()
    env_config = load_env()

    units_table_id = get_table_id(env_config, "AIRTABLE_TABLE_UNITS")
    if not units_table_id:
        print("Error: AIRTABLE_TABLE_UNITS not set in .env. Run setup_schema.py first.")
        sys.exit(1)

    # Build all unit records (AirTable allows up to 10 per batch)
    all_records = []
    for tool_id, units in UNIT_DATA:
        for label, status, condition in units:
            all_records.append({
                "unit_label": label,
                "tool": [tool_id],
                "status": status,
                "condition": condition,
                "qr_code_id": secrets.token_hex(4),  # 8-char hex
            })

    print(f"[units] Creating {len(all_records)} units across {len(UNIT_DATA)} tools...")
    print()

    created = batch_create_records(
        token, base_id, units_table_id, all_records, label="units"
    )

    print()
    print(f"[units] Done. Created {created} unit records in {units_table_id}.")


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 4: --qr
# ═════════════════════════════════════════════════════════════════════════════


def run_qr():
    """Backfill qr_code_id on units that are missing one."""
    token, base_id = get_airtable_config()
    env_config = load_env()

    units_table_id = get_table_id(env_config, "AIRTABLE_TABLE_UNITS")
    if not units_table_id:
        print("Error: AIRTABLE_TABLE_UNITS not set in .env. Run setup_schema.py first.")
        sys.exit(1)

    print("[qr] Fetching all units...")
    units = fetch_all_records(token, base_id, units_table_id)
    print(f"  Found {len(units)} total units")

    # Collect existing QR codes to avoid duplicates
    existing_qr = {
        u["fields"]["qr_code_id"]
        for u in units
        if u["fields"].get("qr_code_id")
    }

    # Find units missing qr_code_id
    missing = [u for u in units if not u["fields"].get("qr_code_id")]

    if not missing:
        print("[qr] All units already have qr_code_id. Nothing to do.")
        return

    print(f"  Found {len(missing)} units without qr_code_id")
    print()

    # Generate unique QR codes and batch update
    updates = []
    for unit in missing:
        # Generate a unique 8-char hex ID
        while True:
            qr_id = secrets.token_hex(4)
            if qr_id not in existing_qr:
                existing_qr.add(qr_id)
                break

        label = unit["fields"].get("unit_label", "unknown")
        updates.append({
            "id": unit["id"],
            "fields": {"qr_code_id": qr_id},
        })
        print(f"  {label} -> {qr_id}")

    updated = batch_update_records(
        token, base_id, units_table_id, updates, label="units"
    )

    print()
    print(f"[qr] Done. Assigned qr_code_id to {updated} units.")


# ═════════════════════════════════════════════════════════════════════════════
# CLI ENTRY POINT
# ═════════════════════════════════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(
        description="MakerLab Tools data pipeline: Excel -> JSON -> AirTable",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
stages:
  --prepare   Read Excel, clean data, output data/tools_v2_data.json  (default)
  --populate  Read tools_v2_data.json, create AirTable records
  --units     Create Unit records for tools with multiple physical units
  --qr        Backfill qr_code_ids on units missing them
  --all       Run all stages in order

examples:
  python populate_data.py                # runs --prepare only
  python populate_data.py --all          # runs all four stages
  python populate_data.py --populate     # populate AirTable only
  python populate_data.py --units --qr   # units + qr backfill
""",
    )
    parser.add_argument("--prepare", action="store_true",
                        help="Stage 1: Read Excel -> tools_v2_data.json")
    parser.add_argument("--populate", action="store_true",
                        help="Stage 2: tools_v2_data.json -> AirTable records")
    parser.add_argument("--units", action="store_true",
                        help="Stage 3: Create Unit records for multi-unit tools")
    parser.add_argument("--qr", action="store_true",
                        help="Stage 4: Backfill qr_code_id on units missing one")
    parser.add_argument("--all", action="store_true",
                        help="Run all stages in order")

    args = parser.parse_args()

    # Default to --prepare if no flags given
    run_any = args.prepare or args.populate or args.units or args.qr or args.all
    if not run_any:
        args.prepare = True

    stages = []
    if args.all:
        stages = ["prepare", "populate", "units", "qr"]
    else:
        if args.prepare:
            stages.append("prepare")
        if args.populate:
            stages.append("populate")
        if args.units:
            stages.append("units")
        if args.qr:
            stages.append("qr")

    print(f"Running stages: {', '.join(stages)}")
    print(f"  Script dir: {SCRIPT_DIR}")
    print(f"  Data dir:   {DATA_DIR}")
    print()

    stage_funcs = {
        "prepare": run_prepare,
        "populate": run_populate,
        "units": run_units,
        "qr": run_qr,
    }

    for stage in stages:
        separator = "=" * 60
        print(separator)
        print(f"  STAGE: {stage}")
        print(separator)
        print()
        stage_funcs[stage]()
        print()

    print("All requested stages complete.")


if __name__ == "__main__":
    main()
