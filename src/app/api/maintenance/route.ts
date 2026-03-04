import { z } from "zod";
import { createMaintenanceLog, uploadAttachment } from "@/lib/airtable";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

const MAX_BASE64_LENGTH = 7_000_000; // ~5MB file ≈ ~6.7MB base64

const maintenanceSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  unit_id: z
    .string()
    .regex(/^rec[A-Za-z0-9]{14}$/, "Invalid unit ID")
    .optional(),
  type: z.enum([
    "Issue Report",
    "Preventive Maintenance",
    "Repair",
    "Inspection",
    "Calibration",
  ]).default("Issue Report"),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium"),
  description: z.string().max(5000).optional(),
  reported_by: z.string().max(100).optional(),
  photos: z
    .array(
      z.object({
        contentType: z.enum(ALLOWED_IMAGE_TYPES as [string, ...string[]], {
          message: "Only JPEG, PNG, WebP, and HEIC images are allowed",
        }),
        filename: z.string().max(255),
        base64: z.string().max(MAX_BASE64_LENGTH, "Photo exceeds 5MB limit"),
      })
    )
    .max(5, "Maximum 5 photos")
    .optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`maint:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!allowed) {
    return Response.json(
      { success: false, error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const parsed = maintenanceSchema.parse(body);

    // Create the maintenance log record
    const record = await createMaintenanceLog({
      title: parsed.title,
      type: parsed.type,
      priority: parsed.priority,
      status: "Open",
      reported_by: parsed.reported_by || undefined,
      description: parsed.description || undefined,
      unit: parsed.unit_id ? [parsed.unit_id] : undefined,
      date_reported: new Date().toISOString().split("T")[0],
    });

    // Upload photos to the created record (sequential to respect rate limits)
    if (parsed.photos?.length) {
      for (const photo of parsed.photos) {
        await uploadAttachment(record.id, "photo_attachments", photo);
      }
    }

    return Response.json({
      success: true,
      id: record.id,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const messages = e.issues.map((issue) => issue.message);
      return Response.json(
        { success: false, error: messages.join(", ") },
        { status: 400 }
      );
    }
    const message = e instanceof Error ? e.message : "Failed to create report";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
