import { createFlag } from "@/lib/airtable";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

const flagSchema = z.object({
  tool_id: z.string().regex(/^rec[A-Za-z0-9]{14}$/, "Invalid tool ID"),
  field_flagged: z.enum([
    "description",
    "image",
    "name",
    "category",
    "location",
    "materials",
    "safety_info",
  ]),
  issue_description: z
    .string()
    .min(1, "Please describe the issue")
    .max(1000),
  suggested_fix: z.string().max(2000).optional(),
  reporter: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`flag:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const data = flagSchema.parse(body);

    const record = await createFlag({
      tool: [data.tool_id],
      field_flagged: data.field_flagged,
      issue_description: data.issue_description,
      suggested_fix: data.suggested_fix || undefined,
      reporter: data.reporter || undefined,
      status: "New",
      created_at: new Date().toISOString(),
    });

    return Response.json({ success: true, id: record.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { success: false, error: err.issues[0].message },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, error: "Failed to submit flag" },
      { status: 500 }
    );
  }
}
