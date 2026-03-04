"""
Create all AirTable tables for the MakerLab Tools app.

Creates 6 tables:
  1. Categories — tool category taxonomy (group/subcategory)
  2. Locations — physical locations (room/zone)
  3. Tools — main tool inventory with linked categories/locations
  4. Units — individual physical unit instances of each tool
  5. Maintenance_Logs — maintenance/issue tracking linked to units
  6. Flags — community-reported content corrections

This is a schema-only script: it creates tables and fields but does NOT
import any tool data or create records.  That is populate_data.py's job.

Usage:
  1. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in .env (next to this script)
  2. Run: python setup_schema.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

API_URL = "https://api.airtable.com/v0"


# ── Config ───────────────────────────────────────────────────────────


def get_config():
    """Load AirTable credentials from .env file or environment variables."""
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

    if not token:
        print("Error: AIRTABLE_API_KEY not found in .env or environment.")
        sys.exit(1)
    if not base_id:
        print("Error: AIRTABLE_BASE_ID not found in .env or environment.")
        sys.exit(1)

    return token, base_id


# ── API helpers ──────────────────────────────────────────────────────


def api_request(method, path, token, data=None):
    """Make an AirTable API request and return parsed JSON."""
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
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"API Error {e.code}: {error_body}")
        sys.exit(1)


def batch_create_records(token, base_id, table_id, records, label="records"):
    """Create records in batches of 10 with rate limiting."""
    created = 0

    for i in range(0, len(records), 10):
        batch = records[i : i + 10]
        payload = {"records": [{"fields": r} for r in batch]}

        result = api_request("POST", f"/{base_id}/{table_id}", token, payload)
        created += len(result["records"])

        batch_num = (i // 10) + 1
        total_batches = (len(records) + 9) // 10
        print(f"  Batch {batch_num}/{total_batches}: {len(result['records'])} {label}")

        time.sleep(0.25)

    return created


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


# ── Table creation helpers ───────────────────────────────────────────


def create_table(token, base_id, name, fields):
    """Create an AirTable table and return its table ID."""
    payload = {"name": name, "fields": fields}
    print(f"Creating {name} table...")
    result = api_request("POST", f"/meta/bases/{base_id}/tables", token, payload)
    table_id = result["id"]
    print(f"  Created: {table_id}")
    time.sleep(0.25)
    return table_id


def add_field(token, base_id, table_id, field_def):
    """Add a single field to an existing table."""
    result = api_request(
        "POST",
        f"/meta/bases/{base_id}/tables/{table_id}/fields",
        token,
        field_def,
    )
    print(f"  Added field: {result.get('name')} ({result.get('type')})")
    time.sleep(0.25)
    return result


# ── 1. Categories ────────────────────────────────────────────────────


def create_categories_table(token, base_id):
    """Create the Categories lookup table (schema only, no records)."""
    fields = [
        {
            "name": "name",
            "type": "singleLineText",
            "description": "Subcategory name (e.g., FDM Printer, Hand Saw)",
        },
        {
            "name": "group",
            "type": "singleSelect",
            "description": "Parent category group",
            "options": {
                "choices": [
                    {"name": "3D Printing"},
                    {"name": "Laser Cutting"},
                    {"name": "CNC & Digital Fabrication"},
                    {"name": "Woodworking"},
                    {"name": "Electronics"},
                    {"name": "Sewing & Textiles"},
                    {"name": "Scanning & VR"},
                    {"name": "Printing & Large Format"},
                    {"name": "Safety & Infrastructure"},
                ]
            },
        },
    ]
    return create_table(token, base_id, "Categories", fields)


# ── 2. Locations ─────────────────────────────────────────────────────


def create_locations_table(token, base_id):
    """Create the Locations lookup table (schema only, no records)."""
    fields = [
        {
            "name": "name",
            "type": "singleLineText",
            "description": "Zone name within the room",
        },
        {
            "name": "room",
            "type": "singleSelect",
            "description": "Building room identifier",
            "options": {
                "choices": [
                    {"name": "Studio 101"},
                    {"name": "Studio 101A"},
                    {"name": "Studio 101C"},
                ]
            },
        },
    ]
    return create_table(token, base_id, "Locations", fields)


# ── 3. Tools ─────────────────────────────────────────────────────────


def create_tools_table(token, base_id, categories_table_id, locations_table_id):
    """Create the Tools table with all fields, then add the notes field.

    multipleSelects (materials, ppe_required, tags) are created without
    predefined choices — AirTable auto-expands them when data is inserted.
    """
    fields = [
        {
            "name": "name",
            "type": "singleLineText",
            "description": "Name of the tool or equipment",
        },
        {
            "name": "description",
            "type": "multilineText",
            "description": "Description of the tool, its capabilities, and common use cases",
        },
        {
            "name": "description_reviewed",
            "type": "checkbox",
            "description": "Whether this description has been verified by staff",
            "options": {"icon": "check", "color": "greenBright"},
        },
        {
            "name": "category",
            "type": "multipleRecordLinks",
            "description": "Tool category — linked to Categories table",
            "options": {"linkedTableId": categories_table_id},
        },
        {
            "name": "location",
            "type": "multipleRecordLinks",
            "description": "Physical location in the lab — linked to Locations table",
            "options": {"linkedTableId": locations_table_id},
        },
        {
            "name": "materials",
            "type": "multipleSelects",
            "description": "Materials this tool works with (e.g., Acrylic, PLA, MDF)",
            "options": {"choices": []},
        },
        {
            "name": "ppe_required",
            "type": "multipleSelects",
            "description": "Personal protective equipment required to operate this tool",
            "options": {"choices": []},
        },
        {
            "name": "tags",
            "type": "multipleSelects",
            "description": "Labels describing capabilities, compatible materials, and common use cases for search",
            "options": {"choices": []},
        },
        {
            "name": "authorized_only",
            "type": "checkbox",
            "description": "Whether this tool is restricted to authorized users only",
            "options": {"icon": "check", "color": "redBright"},
        },
        {
            "name": "training_required",
            "type": "checkbox",
            "description": "Whether prerequisite training is required before use",
            "options": {"icon": "check", "color": "yellowBright"},
        },
        {
            "name": "use_restrictions",
            "type": "multilineText",
            "description": "Notes on compliance, supervision requirements, or usage restrictions",
        },
        {
            "name": "emergency_stop",
            "type": "multilineText",
            "description": "Description of emergency stop location, if applicable",
        },
        {
            "name": "safety_doc_url",
            "type": "url",
            "description": "Link to safety and basic use documentation",
        },
        {
            "name": "sop_url",
            "type": "url",
            "description": "Standard operating procedure or manufacturer manual link",
        },
        {
            "name": "video_url",
            "type": "url",
            "description": "Tutorial video from MakerLAB YouTube or other verified sources",
        },
        {
            "name": "map_tag",
            "type": "singleLineText",
            "description": "Internal ID for a specific cabinet or storage unit within a zone. Used for map overlays and QR code signage.",
        },
        {
            "name": "image_attachments",
            "type": "multipleAttachments",
            "description": "Square-format image with clean background. Prefer product images from manufacturer website when available.",
        },
        {
            "name": "manual_attachments",
            "type": "multipleAttachments",
            "description": "Attached manufacturer manuals or reference documents",
        },
    ]

    table_id = create_table(token, base_id, "Tools", fields)

    # Add the notes field separately (mirrors the setup_notes_field.py step)
    print("  Adding notes field to Tools table...")
    add_field(token, base_id, table_id, {
        "name": "notes",
        "type": "multilineText",
        "description": "User-visible notes about this tool (tips, quirks, known issues)",
    })

    return table_id


# ── 4. Units ─────────────────────────────────────────────────────────


def create_units_table(token, base_id, tools_table_id):
    """Create the Units table linked to the Tools table."""
    fields = [
        {
            "name": "unit_label",
            "type": "singleLineText",
            "description": "Short label identifying this specific unit (e.g., Prusa #1)",
        },
        {
            "name": "tool",
            "type": "multipleRecordLinks",
            "description": "Link to the parent tool in the Tools table",
            "options": {"linkedTableId": tools_table_id},
        },
        {
            "name": "serial_number",
            "type": "singleLineText",
            "description": "Manufacturer serial number, if available",
        },
        {
            "name": "asset_tag",
            "type": "singleLineText",
            "description": "Cornell or lab-assigned asset identifier",
        },
        {
            "name": "status",
            "type": "singleSelect",
            "description": "Current operational status of this unit",
            "options": {
                "choices": [
                    {"name": "Available"},
                    {"name": "In Use"},
                    {"name": "Under Maintenance"},
                    {"name": "Out of Service"},
                    {"name": "Retired"},
                ]
            },
        },
        {
            "name": "condition",
            "type": "singleSelect",
            "description": "Physical condition assessment",
            "options": {
                "choices": [
                    {"name": "Excellent"},
                    {"name": "Good"},
                    {"name": "Fair"},
                    {"name": "Needs Repair"},
                ]
            },
        },
        {
            "name": "date_acquired",
            "type": "date",
            "description": "Date this unit was acquired or put into service",
            "options": {"dateFormat": {"name": "iso"}},
        },
        {
            "name": "notes",
            "type": "multilineText",
            "description": "General notes about this specific unit",
        },
        {
            "name": "qr_code_id",
            "type": "singleLineText",
            "description": "Unique ID encoded in the physical QR sticker on this unit",
        },
    ]
    return create_table(token, base_id, "Units", fields)


# ── 5. Maintenance_Logs ─────────────────────────────────────────────


def create_maintenance_logs_table(token, base_id, units_table_id):
    """Create the Maintenance_Logs table linked to the Units table."""
    fields = [
        {
            "name": "title",
            "type": "singleLineText",
            "description": "Brief summary of the maintenance event or issue",
        },
        {
            "name": "unit",
            "type": "multipleRecordLinks",
            "description": "Link to the specific unit this log entry applies to",
            "options": {"linkedTableId": units_table_id},
        },
        {
            "name": "type",
            "type": "singleSelect",
            "description": "Category of maintenance event",
            "options": {
                "choices": [
                    {"name": "Issue Report"},
                    {"name": "Preventive Maintenance"},
                    {"name": "Repair"},
                    {"name": "Inspection"},
                    {"name": "Calibration"},
                ]
            },
        },
        {
            "name": "priority",
            "type": "singleSelect",
            "description": "Urgency level of this maintenance item",
            "options": {
                "choices": [
                    {"name": "Critical"},
                    {"name": "High"},
                    {"name": "Medium"},
                    {"name": "Low"},
                ]
            },
        },
        {
            "name": "status",
            "type": "singleSelect",
            "description": "Current resolution status",
            "options": {
                "choices": [
                    {"name": "Open"},
                    {"name": "In Progress"},
                    {"name": "Resolved"},
                    {"name": "Closed"},
                ]
            },
        },
        {
            "name": "reported_by",
            "type": "singleLineText",
            "description": "Name or Cornell NetID of the person who reported this",
        },
        {
            "name": "assigned_to",
            "type": "singleLineText",
            "description": "Staff member responsible for resolving this item",
        },
        {
            "name": "description",
            "type": "multilineText",
            "description": "Detailed description of the issue, work performed, or findings",
        },
        {
            "name": "resolution",
            "type": "multilineText",
            "description": "Description of how the issue was resolved or what maintenance was performed",
        },
        {
            "name": "date_reported",
            "type": "date",
            "description": "Date this item was reported or created",
            "options": {"dateFormat": {"name": "iso"}},
        },
        {
            "name": "date_resolved",
            "type": "date",
            "description": "Date this item was resolved or closed",
            "options": {"dateFormat": {"name": "iso"}},
        },
        {
            "name": "photo_attachments",
            "type": "multipleAttachments",
            "description": "Photos documenting the issue, repair process, or final state",
        },
    ]
    return create_table(token, base_id, "Maintenance_Logs", fields)


# ── 6. Flags ─────────────────────────────────────────────────────────


def create_flags_table(token, base_id, tools_table_id):
    """Create the Flags table linked to the Tools table."""
    fields = [
        {
            "name": "title",
            "type": "singleLineText",
            "description": "Auto-generated summary of the flag (primary field)",
        },
        {
            "name": "field_flagged",
            "type": "singleSelect",
            "description": "Which field of the tool record has incorrect information",
            "options": {
                "choices": [
                    {"name": "description"},
                    {"name": "image"},
                    {"name": "name"},
                    {"name": "category"},
                    {"name": "location"},
                    {"name": "materials"},
                    {"name": "safety_info"},
                ]
            },
        },
        {
            "name": "tool",
            "type": "multipleRecordLinks",
            "description": "Link to the tool whose content is being flagged",
            "options": {"linkedTableId": tools_table_id},
        },
        {
            "name": "issue_description",
            "type": "multilineText",
            "description": "Description of what is wrong with the flagged content",
        },
        {
            "name": "suggested_fix",
            "type": "multilineText",
            "description": "Optional suggestion for what the correct information should be",
        },
        {
            "name": "reporter",
            "type": "singleLineText",
            "description": "Name or Cornell NetID of the person who submitted this flag (optional)",
        },
        {
            "name": "status",
            "type": "singleSelect",
            "description": "Current review status of this flag",
            "options": {
                "choices": [
                    {"name": "New"},
                    {"name": "Reviewed"},
                    {"name": "Fixed"},
                    {"name": "Dismissed"},
                ]
            },
        },
        {
            "name": "created_at",
            "type": "dateTime",
            "description": "Date and time this flag was submitted",
            "options": {
                "timeZone": "America/New_York",
                "dateFormat": {"name": "iso"},
                "timeFormat": {"name": "24hour"},
            },
        },
    ]
    return create_table(token, base_id, "Flags", fields)


# ── Main ─────────────────────────────────────────────────────────────


def main():
    token, base_id = get_config()

    print(f"Using base: {base_id}")
    print("Creating 6 tables: Categories, Locations, Tools, Units, Maintenance_Logs, Flags")
    print()

    # 1. Categories (standalone)
    categories_table_id = create_categories_table(token, base_id)
    print()

    # 2. Locations (standalone)
    locations_table_id = create_locations_table(token, base_id)
    print()

    # 3. Tools (links to Categories + Locations; notes field added after creation)
    tools_table_id = create_tools_table(
        token, base_id, categories_table_id, locations_table_id
    )
    print()

    # 4. Units (links to Tools)
    units_table_id = create_units_table(token, base_id, tools_table_id)
    print()

    # 5. Maintenance_Logs (links to Units)
    logs_table_id = create_maintenance_logs_table(token, base_id, units_table_id)
    print()

    # 6. Flags (links to Tools)
    flags_table_id = create_flags_table(token, base_id, tools_table_id)
    print()

    # ── Summary ──────────────────────────────────────────────────────
    print("=" * 60)
    print("All 6 tables created successfully!")
    print("=" * 60)
    print(f"  Categories:       {categories_table_id}")
    print(f"  Locations:        {locations_table_id}")
    print(f"  Tools:            {tools_table_id}")
    print(f"  Units:            {units_table_id}")
    print(f"  Maintenance_Logs: {logs_table_id}")
    print(f"  Flags:            {flags_table_id}")
    print()
    print(f"  Base URL: https://airtable.com/{base_id}")
    print()
    print("Next steps:")
    print("  1. Update CLAUDE.md / .env with the new table IDs above")
    print("  2. Run populate_data.py to import tool, category, and location records")


if __name__ == "__main__":
    main()
