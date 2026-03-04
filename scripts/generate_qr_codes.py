"""
Generate printable QR code images for all units.

Each QR code encodes: {BASE_URL}/units/qr/{qr_code_id}
Output: qr_codes/ directory with one PNG per unit.

Usage:
  1. pip install qrcode[pil]  (one-time)
  2. Set BASE_URL in .env or environment (defaults to https://makerlab-tools.vercel.app)
  3. Run: python generate_qr_codes.py

Dependencies: qrcode, Pillow (PIL)
"""

import json
import os
import sys
import urllib.request

# ── Configuration ────────────────────────────────────────────────────

API_URL = "https://api.airtable.com/v0"


def get_config():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    config = {}
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    key, val = line.split("=", 1)
                    config[key] = val

    token = config.get("AIRTABLE_API_KEY") or os.environ.get("AIRTABLE_API_KEY")
    base_id = config.get("AIRTABLE_BASE_ID") or os.environ.get("AIRTABLE_BASE_ID")

    if not token or not base_id:
        print("Error: AIRTABLE_API_KEY and AIRTABLE_BASE_ID required in .env")
        sys.exit(1)

    base_url = (
        config.get("BASE_URL")
        or os.environ.get("BASE_URL")
        or "https://makerlab-tools.vercel.app"
    )

    units_table = config.get("AIRTABLE_TABLE_UNITS") or os.environ.get("AIRTABLE_TABLE_UNITS")
    if not units_table:
        print("Error: AIRTABLE_TABLE_UNITS is required in .env")
        sys.exit(1)

    return token, base_id, base_url, units_table


def fetch_all_units(token, base_id, units_table):
    records = []
    offset = None
    while True:
        url = f"{API_URL}/{base_id}/{units_table}"
        if offset:
            url += f"?offset={offset}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
        records.extend(data["records"])
        offset = data.get("offset")
        if not offset:
            break
    return records


def main():
    try:
        import qrcode
    except ImportError:
        print("Error: qrcode package not installed.")
        print("Run: pip install qrcode[pil]")
        sys.exit(1)

    token, base_id, base_url, units_table = get_config()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(script_dir, "qr_codes")
    os.makedirs(out_dir, exist_ok=True)

    print(f"Base URL: {base_url}")
    print(f"Output: qr_codes/")
    print()

    units = fetch_all_units(token, base_id, units_table)
    print(f"Found {len(units)} units")

    generated = 0
    skipped = 0

    for unit in units:
        fields = unit["fields"]
        qr_code_id = fields.get("qr_code_id")
        label = fields.get("unit_label", "unknown")

        if not qr_code_id:
            print(f"  SKIP {label} — no qr_code_id")
            skipped += 1
            continue

        url = f"{base_url}/units/qr/{qr_code_id}"

        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=4,
        )
        qr.add_data(url)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        # Safe filename
        safe_label = label.replace("/", "-").replace(" ", "_").replace("#", "")
        filename = f"{safe_label}_{qr_code_id}.png"
        filepath = os.path.join(out_dir, filename)
        img.save(filepath)

        generated += 1

    print()
    print(f"Done. Generated {generated} QR codes, skipped {skipped}.")
    print(f"Files in: {out_dir}")


if __name__ == "__main__":
    main()
