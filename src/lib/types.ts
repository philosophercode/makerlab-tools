// AirTable record wrapper
export interface AirtableRecord<T> {
  id: string;
  createdTime: string;
  fields: T;
}

// AirTable attachment
export interface Attachment {
  id: string;
  url: string;
  filename: string;
  size: number;
  type: string;
  width?: number;
  height?: number;
  thumbnails?: {
    small: { url: string; width: number; height: number };
    large: { url: string; width: number; height: number };
    full?: { url: string; width: number; height: number };
  };
}

// ── Categories table ────────────────────────────────────────────────

export interface CategoryFields {
  name: string;
  group: string;
}

export type CategoryRecord = AirtableRecord<CategoryFields>;

// ── Locations table ─────────────────────────────────────────────────

export interface LocationFields {
  name: string; // zone name
  room: string;
}

export type LocationRecord = AirtableRecord<LocationFields>;

// ── Tools table ─────────────────────────────────────────────────────

export interface ToolFields {
  name: string;
  description?: string;
  description_reviewed?: boolean;
  category?: string[]; // linked record IDs
  location?: string[]; // linked record IDs
  materials?: string[];
  ppe_required?: string[];
  tags?: string[];
  authorized_only?: boolean;
  training_required?: boolean;
  use_restrictions?: string;
  emergency_stop?: string;
  safety_doc_url?: string;
  sop_url?: string;
  video_url?: string;
  map_tag?: string;
  image_attachments?: Attachment[];
  generated_image?: Attachment[];
  manual_attachments?: Attachment[];
  notes?: string;
}

export type ToolRecord = AirtableRecord<ToolFields>;

// Resolved tool with category/location objects instead of IDs
export interface ToolWithMeta {
  id: string;
  name: string;
  description: string;
  category_group: string;
  category_sub: string;
  location_room: string;
  location_zone: string;
  materials: string[];
  ppe_required: string[];
  tags: string[];
  authorized_only: boolean;
  training_required: boolean;
  use_restrictions: string | null;
  emergency_stop: string | null;
  notes: string | null;
  safety_doc_url: string | null;
  sop_url: string | null;
  video_url: string | null;
  map_tag: string | null;
  image_url: string | null;
  generated_image_url: string | null;
  image_attachments: Attachment[];
  generated_image: Attachment[];
  manual_attachments: Attachment[];
}

// ── Units table ─────────────────────────────────────────────────────

export type UnitStatus =
  | "Available"
  | "In Use"
  | "Under Maintenance"
  | "Out of Service"
  | "Retired";

export type UnitCondition = "Excellent" | "Good" | "Fair" | "Needs Repair";

export interface UnitFields {
  unit_label: string;
  tool?: string[]; // linked record IDs
  serial_number?: string;
  asset_tag?: string;
  status?: UnitStatus;
  condition?: UnitCondition;
  date_acquired?: string;
  notes?: string;
  qr_code_id?: string;
}

export type UnitRecord = AirtableRecord<UnitFields>;

// ── Maintenance_Logs table ──────────────────────────────────────────

export type MaintenanceType =
  | "Issue Report"
  | "Preventive Maintenance"
  | "Repair"
  | "Inspection"
  | "Calibration";

export type MaintenancePriority = "Critical" | "High" | "Medium" | "Low";

export type MaintenanceStatus = "Open" | "In Progress" | "Resolved" | "Closed";

export interface MaintenanceLogFields {
  title: string;
  unit?: string[]; // linked record IDs
  type?: MaintenanceType;
  priority?: MaintenancePriority;
  status?: MaintenanceStatus;
  reported_by?: string;
  assigned_to?: string;
  description?: string;
  resolution?: string;
  date_reported?: string;
  date_resolved?: string;
  photo_attachments?: Attachment[];
}

export type MaintenanceLogRecord = AirtableRecord<MaintenanceLogFields>;

// ── Flags table ─────────────────────────────────────────────────────

export type FlaggedField =
  | "description"
  | "image"
  | "name"
  | "category"
  | "location"
  | "materials"
  | "safety_info";

export type FlagStatus = "New" | "Reviewed" | "Fixed" | "Dismissed";

export interface FlagFields {
  tool?: string[]; // linked record IDs
  field_flagged?: FlaggedField;
  issue_description?: string;
  suggested_fix?: string;
  reporter?: string;
  status?: FlagStatus;
  created_at?: string;
}

export type FlagRecord = AirtableRecord<FlagFields>;
