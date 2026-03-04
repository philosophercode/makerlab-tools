"""
Upload tool images to the Tools table in AirTable.

Matches image files in tool_images/ to tool records by name,
then uploads each image to the image_attachments field using
the AirTable content upload API.

Usage:
  python upload_images.py [--img-dir DIR] [--force-replace]
"""

import base64
import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.request
import urllib.error

API_URL = "https://api.airtable.com/v0"
CONTENT_URL = "https://content.airtable.com/v0"
IMG_DIR = os.path.join(os.path.dirname(__file__), "tool_images")
IMAGE_FIELD_NAME = "image_attachments"

# Manual overrides for filenames that don't exactly match tool names
FILENAME_TO_TOOL = {
    "DEWALT DCB107 12V_20V MAX Lithium Ion Charger": "DEWALT DCB107 12V/20V MAX Lithium Ion Charger",
    "EverSewn Sparrow X2 Sewing & Embroidery Machine,": "EverSewn Sparrow X2 Sewing & Embroidery Machine",
    "Form cure": "Form Cure",
    "Heat Gun (TruePower _ DrillMaster)": "Heat Gun (TruePower / DrillMaster)",
    "MAKITA  Palm Sander RT0701C": "MAKITA RT0701C",
    "MAKITA  Plunge Bass": "MAKITA Plunge Base",
    "RYOBI P322 ONE+ HP 18V 18-Gauge Brushless Cordless Airstrike Brad Nailer": "RYOBI P322 Brad Nailer",
    "RYOBI PCL235 ONE+ 18V Drill_ Driver": "RYOBI PCL235 ONE+ 18V Drill/ Driver",
    "SUIZAN  Dozuki Dovetail Saw": "SUIZAN Dozuki Dovetail Saw",
    "iPad 6th generation [MR7F2LL._A]": "iPad 6th generation [MR7F2LL./A]",
}


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

    tools_table = config.get("AIRTABLE_TABLE_TOOLS") or os.environ.get("AIRTABLE_TABLE_TOOLS")
    if not tools_table:
        print("Error: AIRTABLE_TABLE_TOOLS is required in .env")
        sys.exit(1)

    return token, base_id, tools_table


def api_request(method, url, token, data=None):
    """Make an API request and return parsed JSON."""
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
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  API Error {e.code}: {error_body}")
        return None


def fetch_all_records(token, base_id, table_id):
    """Fetch all records handling pagination."""
    records = []
    offset = None

    while True:
        url = f"{API_URL}/{base_id}/{table_id}"
        if offset:
            url += f"?offset={offset}"

        result = api_request("GET", url, token)
        if not result:
            break
        records.extend(result.get("records", []))

        offset = result.get("offset")
        if not offset:
            break
        time.sleep(0.25)

    return records


def upload_attachment(token, base_id, record_id, file_path):
    """Upload a file to image_attachments using JSON + base64 encoding."""
    filename = os.path.basename(file_path)
    content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    with open(file_path, "rb") as f:
        file_data = f.read()

    payload = {
        "contentType": content_type,
        "filename": filename,
        "file": base64.encodebytes(file_data).decode("utf8"),
    }

    url = f"{CONTENT_URL}/{base_id}/{record_id}/{IMAGE_FIELD_NAME}/uploadAttachment"
    body = json.dumps(payload).encode()

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"  Upload error {e.code}: {error_body[:200]}")
        return None


def clear_attachments(token, base_id, tools_table, record_id):
    """Clear existing attachments on image_attachments field."""
    url = f"{API_URL}/{base_id}/{tools_table}/{record_id}"
    payload = {"fields": {"image_attachments": []}}
    result = api_request("PATCH", url, token, payload)
    return bool(result)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--img-dir",
        default=os.environ.get("IMG_DIR", IMG_DIR),
        help="Directory containing local images to upload",
    )
    parser.add_argument(
        "--force-replace",
        action="store_true",
        help="Replace existing Airtable image attachments with local files",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    token, base_id, tools_table = get_config()
    img_dir = args.img_dir

    # Fetch all tool records to get name -> record_id mapping
    print("Fetching tool records from AirTable...")
    records = fetch_all_records(token, base_id, tools_table)
    name_to_record = {}
    already_has_image = set()
    for rec in records:
        name = rec["fields"].get("name")
        if name:
            name_to_record[name] = rec["id"]
            if rec["fields"].get("image_attachments"):
                already_has_image.add(name)
    print(f"  Found {len(name_to_record)} tools ({len(already_has_image)} already have images)")

    # Build image file -> tool name mapping
    img_files = [f for f in os.listdir(img_dir) if not f.startswith(".")]
    print(f"  Found {len(img_files)} images on disk")

    matched = []
    unmatched = []

    for img_file in sorted(img_files):
        stem = os.path.splitext(img_file)[0]

        # Check manual override first, then exact match
        tool_name = FILENAME_TO_TOOL.get(stem, stem)

        if tool_name in name_to_record and (
            args.force_replace or tool_name not in already_has_image
        ):
            matched.append((img_file, tool_name, name_to_record[tool_name]))
        elif tool_name in already_has_image:
            pass  # skip, already uploaded
        else:
            unmatched.append((img_file, stem))

    print(f"  Matched: {len(matched)}, Unmatched: {len(unmatched)}")

    if unmatched:
        print("\n  Unmatched images (skipping):")
        for img, stem in unmatched:
            print(f"    {img}")

    # Upload images
    print(f"\nUploading {len(matched)} images...")
    uploaded = 0
    errors = 0

    for i, (img_file, tool_name, record_id) in enumerate(matched, 1):
        file_path = os.path.join(img_dir, img_file)
        file_size = os.path.getsize(file_path)

        print(f"  [{i}/{len(matched)}] {tool_name} ({file_size // 1024}KB)...", end=" ", flush=True)

        if args.force_replace:
            ok = clear_attachments(token, base_id, tools_table, record_id)
            if not ok:
                errors += 1
                print("FAILED (clear)")
                time.sleep(0.3)
                continue
            time.sleep(0.15)

        result = upload_attachment(token, base_id, record_id, file_path)

        if result:
            uploaded += 1
            print("OK")
        else:
            errors += 1
            print("FAILED")

        # Rate limit: 5 requests per second for content API
        time.sleep(0.3)

    print(f"\nDone! Uploaded {uploaded}/{len(matched)} images ({errors} errors)")

    if unmatched:
        print(f"\nTools without images ({len(unmatched)} files didn't match + tools with no image):")
        no_image_tools = set(name_to_record.keys()) - {m[1] for m in matched}
        for name in sorted(no_image_tools):
            print(f"  {name}")


if __name__ == "__main__":
    main()
