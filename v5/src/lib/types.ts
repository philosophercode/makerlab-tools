export interface NotionRecord<T> {
  id: string;
  createdTime: string;
  lastEditedTime: string;
  fields: T;
}

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

export interface CategoryFields {
  name: string;
  group: string;
}

export type CategoryRecord = NotionRecord<CategoryFields>;

export interface LocationFields {
  id: string;
  zone: string;
  room: string;
}

export type LocationRecord = NotionRecord<LocationFields>;

export interface ToolFields {
  name: string;
  description?: string;
  category?: string[];
  location?: string[];
  materials?: string[];
  ppe_required?: string[];
  tags?: string[];
  training_required?: boolean;
  use_restrictions?: string;
  emergency_stop?: string;
  image_attachments?: Attachment[];
  notes?: string;
  published?: boolean;
  /**
   * Write-only: references to images already uploaded via the Notion
   * file_upload API. The read path returns URL-based attachments in
   * `image_attachments`; this field is consumed when creating a record so
   * the Notion `image_attachments` files property is built with
   * `type: "file_upload"` entries.
   */
  image_uploads?: Array<{ id: string; name: string }>;
}

export type ToolRecord = NotionRecord<ToolFields>;

export interface ResourceFields {
  title: string;
  tool?: string[];
  type?: string;
  url?: string;
  files?: Attachment[];
  notes?: string;
  published?: boolean;
}

export type ResourceRecord = NotionRecord<ResourceFields>;

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
  map_tag: string | null;
  image_url: string | null;
  image_attachments: Attachment[];
}

export type UnitStatus =
  | "Available"
  | "In Use"
  | "Under Maintenance"
  | "Out of Service"
  | "Retired";

export type UnitCondition = "Excellent" | "Good" | "Fair" | "Needs Repair";

export interface UnitFields {
  unit_label: string;
  tool?: string[];
  serial_number?: string;
  asset_tag?: string;
  status?: UnitStatus;
  condition?: UnitCondition;
  date_acquired?: string;
  notes?: string;
}

export type UnitRecord = NotionRecord<UnitFields>;

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
  unit?: string[];
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
  /**
   * Write-only: references to files already uploaded via the Notion
   * file_upload API. The read path returns URL-based attachments in
   * `photo_attachments`; this field is consumed when creating a record so
   * the Notion `files` property is built with `type: "file_upload"` entries.
   */
  photo_uploads?: Array<{ id: string; name: string }>;
}

export type MaintenanceLogRecord = NotionRecord<MaintenanceLogFields>;

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
  title: string;
  tool?: string[];
  field_flagged?: FlaggedField;
  issue_description?: string;
  suggested_fix?: string;
  reporter?: string;
  status?: FlagStatus;
  created_at?: string;
}

export type FlagRecord = NotionRecord<FlagFields>;
