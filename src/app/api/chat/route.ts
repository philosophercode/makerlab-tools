import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  fetchTool,
  fetchAllCategories,
  fetchAllLocations,
  fetchAllTools,
  fetchAllUnits,
  fetchUnit,
  fetchMaintenanceLogsByUnit,
  resolveTools,
  createMaintenanceLog,
} from "@/lib/airtable";
import { fetchDocContent } from "@/lib/doc-fetcher";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { generateImage } from "@/lib/gemini-image";
import { siteConfig } from "@/lib/site-config";

export const maxDuration = 60;

interface LabeledDoc {
  label: string;
  url: string;
  text: string;
}

function buildToolSystemPrompt(tool: ReturnType<typeof resolveTools>[0], docs: LabeledDoc[]) {
  let prompt = `You are a helpful assistant for the ${siteConfig.institution} ${siteConfig.name.replace("Tools", "").trim()}. You are answering questions about a specific tool.

## Tool Information
- **Name:** ${tool.name}
- **Category:** ${tool.category_group} — ${tool.category_sub}
- **Location:** ${tool.location_room} — ${tool.location_zone}
- **Description:** ${tool.description}`;

  if (tool.materials.length > 0) {
    prompt += `\n- **Compatible Materials:** ${tool.materials.join(", ")}`;
  }
  if (tool.ppe_required.length > 0) {
    prompt += `\n- **PPE Required:** ${tool.ppe_required.join(", ")}`;
  }
  if (tool.training_required) {
    prompt += `\n- **Training Required:** Yes — students must complete training before using this tool.`;
  }
  if (tool.authorized_only) {
    prompt += `\n- **Authorization Required:** Yes — only authorized users may operate this tool.`;
  }
  if (tool.use_restrictions) {
    prompt += `\n- **Use Restrictions:** ${tool.use_restrictions}`;
  }
  if (tool.emergency_stop) {
    prompt += `\n- **Emergency Stop:** ${tool.emergency_stop}`;
  }
  if (tool.safety_doc_url) {
    prompt += `\n- **Safety Doc:** ${tool.safety_doc_url}`;
  }
  if (tool.sop_url) {
    prompt += `\n- **SOP:** ${tool.sop_url}`;
  }
  if (tool.video_url) {
    prompt += `\n- **Video Tutorial:** ${tool.video_url}`;
  }

  if (docs.length > 0) {
    prompt += `\n\n## Source Documents\n`;
    for (const doc of docs) {
      prompt += `\n### ${doc.label}\nURL: ${doc.url}\n\n${doc.text}\n\n---\n`;
    }
  }

  prompt += `\n\n## Guidelines
- Answer questions about this tool's capabilities, safety, setup, and materials.
- When your answer uses information from the source documents above, cite the source with the page number. Use the format: *Source: [document name](url), p. X* at the end of the relevant point or paragraph. Page numbers are marked as [Page N] in the document text.
- Be concise but thorough. Use bullet points for lists.
- If you don't know something specific about this tool, say so rather than guessing.
- You are speaking to ${siteConfig.audience}.
- If a student reports an issue or problem with equipment, use the report_issue tool to log it. Gather a brief title and description from the conversation. Ask for their name if they haven't provided it.
- You have access to web search. Use it when a student asks about something not covered in the source documents — for example, material settings, techniques, troubleshooting tips, or comparisons with other equipment. Cite web sources when you use them.
- Students may share photos. If they share an image of equipment, identify it from the inventory if possible. If they share an image showing damage or a problem, help diagnose it and suggest filing a maintenance report.
- If you identify a specific unit, call \`get_unit_details\` and include a clickable unit link in your answer using this exact format: \`[Unit Label](/units/{unit_id})\`.

## Formatting Rules
- For bullet lists, ALWAYS put the content on the SAME line as the dash. Write \`- Content here\` not a dash on one line and content on the next.
- Never put blank lines between bullet list items. Keep list items tight with no gaps.
- Use paragraphs (not bullets) for longer explanatory text. Reserve bullets for short, scannable items.

## Follow-ups
- At the end of every response, call the suggest_followups tool with 2-4 short, natural follow-up questions the student might want to ask next based on the conversation so far.`;

  return prompt;
}

function buildGeneralSystemPrompt(tools: ReturnType<typeof resolveTools>) {
  const inventory = tools
    .map(
      (t) =>
        `- **${t.name}** [id: ${t.id}] (${t.category_group} — ${t.category_sub}, ${t.location_room}): ${t.description?.slice(0, 120) || "No description"}${t.materials.length > 0 ? `. Materials: ${t.materials.join(", ")}` : ""}`
    )
    .join("\n");

  return `You are a helpful assistant for the ${siteConfig.institution} ${siteConfig.name.replace("Tools", "").trim()}. You help students find and learn about makerspace equipment, and help them plan builds using available tools.

## Available Equipment (${tools.length} tools)
${inventory}

## Guidelines
- Help students find the right tool for their project.
- When recommending tools, mention their location and any safety requirements.
- Be concise but thorough. Use bullet points for lists.
- When a student asks detailed questions about a specific tool (how to use it, safety, materials, setup), use the get_tool_details tool to fetch full information and documentation before answering. This gives you access to safety docs, SOPs, and detailed specs.
- When your answer uses information from fetched documentation, cite the source. Use the format: *Source: [document name](url)* at the end of the relevant point or paragraph.
- You are speaking to ${siteConfig.audience}. Be encouraging and supportive.
- If a student reports an issue or problem with equipment, use the report_issue tool to log it. Gather a brief title and description from the conversation. Ask for their name if they haven't provided it.
- You have access to web search. Use it when a student asks about something not covered in the tool inventory — for example, material recommendations, techniques, or general makerspace questions. Cite web sources when you use them.
- Students may share photos of equipment. Help identify tools from images, diagnose problems shown in photos, or suggest next steps based on what you see.
- If you identify a specific unit from a photo, call \`get_unit_details\` and include a clickable unit link in your answer using this exact format: \`[Unit Label](/units/{unit_id})\`.

## Project Planning
When a student describes something they want to build or asks for help planning a project, guide them through a structured conversation:

1. **Understand the project:** Ask what they want to make. Get a clear picture before suggesting tools.
2. **Clarify constraints:** Ask follow-up questions one at a time — material preferences, precision needed (rough prototype vs. finished piece), skill level, size constraints, timeline.
3. **Generate a plan:** Once you understand the project, provide a structured plan:
   - **Materials needed** — specific materials and approximate quantities
   - **Tools & steps** — ordered list of MakerLab tools they'll use, with a brief description of what to do at each step. Link to tool detail pages using the format: [Tool Name](/tools/{tool_id})
   - **Safety requirements** — PPE needed, training required, any authorization needed
   - **Estimated time** — rough time per step
   - **Tips** — common mistakes to avoid, helpful techniques
- Only recommend tools that are in the MakerLab inventory above.
- When linking to a tool detail page, ALWAYS use the exact id shown in inventory lines (\`[id: ...]\`) and format links as \`/tools/<id>\`. Never invent or guess IDs.
- If a project isn't feasible with MakerLab equipment, explain why and suggest alternatives.

## Project Visualization
You have a \`visualize_project\` tool that generates a concept image of what the finished project could look like.
- Use it when a student has described their project in enough detail that you can picture the end result.
- Call it AFTER you've gathered key details (materials, size, style) — not on the very first message.
- Write a detailed, visual prompt describing the finished object: materials, colors, textures, setting, lighting, and camera angle. Think product photography.
- IMPORTANT: Always describe the COMPLETE finished object fully visible in the frame. Write "full view of the entire [object]" in your prompt. Never describe a close-up or partial view — the student needs to see the whole thing.
- Do NOT use it for vague requests like "I want to make something" — wait until you know what they want.
- If the image fails, continue normally — visualization is optional.

## Step-by-Step Infographics
You have a \`generate_infographic\` tool that creates visual how-to guides.
- Use it when a student asks "how do I make X?" and you've already outlined the steps in text.
- First explain the steps in your message, then call generate_infographic to create a visual summary.
- Keep steps concise (3-8 steps). Each step should be one clear action.
- The infographic is a visual companion to your text explanation — not a replacement for it.

## Formatting Rules
- For bullet lists, ALWAYS put the content on the SAME line as the dash. Write \`- Content here\` not a dash on one line and content on the next.
- Never put blank lines between bullet list items. Keep list items tight with no gaps.
- Use paragraphs (not bullets) for longer explanatory text. Reserve bullets for short, scannable items.

## Follow-ups
- At the end of every response, call the suggest_followups tool with 2-4 short, natural follow-up questions the student might want to ask next based on the conversation so far.`;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { allowed } = await rateLimitAsync(`chat:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  try {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 200_000) {
    return Response.json(
      { error: "Payload too large" },
      { status: 413 }
    );
  }

  const { messages, toolId }: { messages: UIMessage[]; toolId?: string } =
    await req.json();
  if (!Array.isArray(messages) || messages.length > 50) {
    return Response.json({ error: "Too many messages" }, { status: 400 });
  }

  const totalText = messages
    .flatMap((m) => m.parts || [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof (p as { text?: unknown }).text === "string")
    .reduce((sum, p) => sum + p.text.length, 0);
  if (totalText > 50_000) {
    return Response.json({ error: "Message content too large" }, { status: 413 });
  }

  let systemPrompt: string;
  let resolvedTools: ReturnType<typeof resolveTools> = [];

  if (toolId) {
    // Tool-specific chat
    const [toolRecord, categories, locations] = await Promise.all([
      fetchTool(toolId),
      fetchAllCategories(),
      fetchAllLocations(),
    ]);
    const [resolved] = resolveTools([toolRecord], categories, locations);

    // Fetch text content from all linked docs (PDFs, Google Docs, etc.)
    const docSources = [
      { label: "Safety Document", url: resolved.safety_doc_url },
      { label: "Operating Manual / SOP", url: resolved.sop_url },
      { label: "Video Tutorial", url: resolved.video_url },
    ].filter((d) => d.url) as { label: string; url: string }[];

    const docs: LabeledDoc[] = (
      await Promise.all(
        docSources.map(async (d) => {
          const text = await fetchDocContent(d.url);
          return text ? { label: d.label, url: d.url, text } : null;
        })
      )
    ).filter(Boolean) as LabeledDoc[];

    systemPrompt = buildToolSystemPrompt(resolved, docs);
  } else {
    // General or planner chat
    const [tools, categories, locations] = await Promise.all([
      fetchAllTools(),
      fetchAllCategories(),
      fetchAllLocations(),
    ]);
    resolvedTools = resolveTools(tools, categories, locations);
    systemPrompt = buildGeneralSystemPrompt(resolvedTools);
  }

  // Build unit lookup for the report tool (lazy — only fetched if tool is called)
  let unitLabelMap: Map<string, string> | null = null;
  async function getUnitLabelMap() {
    if (unitLabelMap) return unitLabelMap;
    try {
      const units = await fetchAllUnits();
      unitLabelMap = new Map(units.map((u) => [u.fields.unit_label.toLowerCase(), u.id]));
    } catch {
      unitLabelMap = new Map();
    }
    return unitLabelMap;
  }

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        system: systemPrompt,
        messages: modelMessages,
        tools: {
          web_search: anthropic.tools.webSearch_20250305({
            maxUses: 3,
          }),
          ...(!toolId && {
            get_tool_details: tool({
              description:
                "Fetch detailed information and documentation for a specific tool. Use this when a student asks detailed questions about a tool — how to use it, safety info, materials, etc.",
              inputSchema: z.object({
                tool_name: z
                  .string()
                  .describe("The name of the tool to look up, e.g. 'Trotec Speedy 400' or 'Prusa MK4S'"),
              }),
              execute: async ({ tool_name }) => {
                const match = resolvedTools.find(
                  (t) => t.name.toLowerCase() === tool_name.toLowerCase()
                ) || resolvedTools.find(
                  (t) => t.name.toLowerCase().includes(tool_name.toLowerCase())
                );

                if (!match) {
                  return { found: false, message: `No tool found matching "${tool_name}".` };
                }

                const docSources = [
                  { label: "Safety Document", url: match.safety_doc_url },
                  { label: "Operating Manual / SOP", url: match.sop_url },
                  { label: "Video Tutorial", url: match.video_url },
                ].filter((d) => d.url) as { label: string; url: string }[];

                const fetchedDocs = (
                  await Promise.all(
                    docSources.map(async (d) => {
                      const text = await fetchDocContent(d.url);
                      return text ? { label: d.label, url: d.url, text } : null;
                    })
                  )
                ).filter(Boolean) as LabeledDoc[];

                return {
                  found: true,
                  name: match.name,
                  description: match.description,
                  category: `${match.category_group} — ${match.category_sub}`,
                  location: `${match.location_room} — ${match.location_zone}`,
                  materials: match.materials,
                  ppe_required: match.ppe_required,
                  training_required: match.training_required,
                  authorized_only: match.authorized_only,
                  use_restrictions: match.use_restrictions || null,
                  emergency_stop: match.emergency_stop || null,
                  safety_doc_url: match.safety_doc_url || null,
                  sop_url: match.sop_url || null,
                  video_url: match.video_url || null,
                  sources: fetchedDocs.map((d) => ({ label: d.label, url: d.url, excerpt: d.text.slice(0, 5000) })),
                  detail_page: `/tools/${match.id}`,
                };
              },
            }),
            visualize_project: tool({
              description:
                "Generate a concept image of a student's project. Use this after gathering enough detail about what they want to build. Write a detailed visual prompt describing the finished object.",
              inputSchema: z.object({
                prompt: z
                  .string()
                  .describe(
                    "A detailed scene description for image generation: describe the finished object, materials, colors, textures, setting, lighting, and camera angle. Think product photography."
                  ),
              }),
              execute: async ({ prompt }) => {
                try {
                  const { imageBase64, mimeType, text } = await generateImage(prompt);
                  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
                  writer.write({
                    type: "file",
                    url: dataUrl,
                    mediaType: mimeType,
                  });
                  return {
                    success: true,
                    message: text || "Image generated successfully.",
                  };
                } catch (err) {
                  const msg = err instanceof Error ? err.message : "Image generation failed";
                  return { success: false, message: msg };
                }
              },
            }),
            generate_infographic: tool({
              description:
                "Generate a visual step-by-step infographic showing how to make or build something using MakerLab tools. Use when a student asks how to make something and a visual guide would help. Generate AFTER you've discussed the steps in text so the student has context.",
              inputSchema: z.object({
                title: z
                  .string()
                  .describe("Short title for the infographic, e.g. 'How to Laser Cut a Phone Stand'"),
                steps: z
                  .array(
                    z.object({
                      number: z.number(),
                      label: z.string().describe("Short action label, e.g. 'Cut the acrylic'"),
                      detail: z.string().describe("Brief detail, e.g. 'Use Trotec Speedy 400 at 60% power'"),
                    })
                  )
                  .min(3)
                  .max(8)
                  .describe("The ordered steps to illustrate"),
              }),
              execute: async ({ title, steps }) => {
                try {
                  const stepDescriptions = steps
                    .map((s) => `Step ${s.number}: "${s.label}" — ${s.detail}`)
                    .join("\n");
                  const prompt = `Create a clean, professional vertical infographic titled "${title}".
Layout: numbered steps flowing top to bottom, each with a small icon/illustration and text label.
Steps:
${stepDescriptions}
Style: flat design, warm color palette with ${siteConfig.colors.primary} accents, white background, clear numbered circles, simple tool/object illustrations beside each step. Make it easy to read at phone screen size. Do NOT include any watermarks or logos.`;

                  const { imageBase64, mimeType, text } = await generateImage(prompt);
                  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
                  writer.write({
                    type: "file",
                    url: dataUrl,
                    mediaType: mimeType,
                  });
                  return {
                    success: true,
                    message: text || "Infographic generated.",
                  };
                } catch (err) {
                  const msg = err instanceof Error ? err.message : "Infographic generation failed";
                  return { success: false, message: msg };
                }
              },
            }),
          }),
          get_unit_details: tool({
            description:
              "Fetch details for a specific unit (individual machine instance), including its status, condition, maintenance history, and parent tool's SOP/safety docs. Use when a student asks about a specific unit like 'Prusa #1' or reports an issue with a numbered unit.",
            inputSchema: z.object({
              unit_label: z.string().describe("Unit label, e.g. 'Prusa #1', 'Form 2 #1'"),
            }),
            execute: async ({ unit_label }) => {
              // Try exact match first
              const allUnits = await fetchAllUnits();
              const unit = allUnits.find(
                (u) => u.fields.unit_label.toLowerCase() === unit_label.toLowerCase()
              ) || allUnits.find(
                (u) => u.fields.unit_label.toLowerCase().includes(unit_label.toLowerCase())
              );

              if (!unit) {
                return { found: false, message: `No unit found matching "${unit_label}". Available units: ${allUnits.slice(0, 10).map((u) => u.fields.unit_label).join(", ")}...` };
              }

              // Fetch maintenance logs
              const logs = await fetchMaintenanceLogsByUnit(unit.id);

              // Resolve parent tool
              const toolId = unit.fields.tool?.[0];
              let parentToolInfo = null;
              if (toolId) {
                try {
                  const toolRecord = await fetchTool(toolId);
                  const [categories, locations] = await Promise.all([
                    fetchAllCategories(),
                    fetchAllLocations(),
                  ]);
                  const [resolved] = resolveTools([toolRecord], categories, locations);
                  parentToolInfo = {
                    name: resolved.name,
                    sop_url: resolved.sop_url,
                    safety_doc_url: resolved.safety_doc_url,
                    video_url: resolved.video_url,
                    training_required: resolved.training_required,
                    authorized_only: resolved.authorized_only,
                    detail_page: `/tools/${resolved.id}`,
                  };
                } catch { /* skip */ }
              }

              return {
                found: true,
                unit_label: unit.fields.unit_label,
                id: unit.id,
                detail_page: `/units/${unit.id}`,
                status: unit.fields.status || "Unknown",
                condition: unit.fields.condition || "Unknown",
                serial_number: unit.fields.serial_number || null,
                asset_tag: unit.fields.asset_tag || null,
                date_acquired: unit.fields.date_acquired || null,
                notes: unit.fields.notes || null,
                parent_tool: parentToolInfo,
                maintenance_logs: logs.slice(0, 10).map((l) => ({
                  title: l.fields.title,
                  type: l.fields.type || "",
                  priority: l.fields.priority || "",
                  status: l.fields.status || "",
                  date_reported: l.fields.date_reported || "",
                  description: l.fields.description || "",
                })),
              };
            },
          }),
          suggest_followups: tool({
            description:
              "Suggest 2-4 follow-up questions the student might want to ask next. Call this at the end of every response.",
            inputSchema: z.object({
              suggestions: z
                .array(z.string())
                .min(2)
                .max(4)
                .describe("Short, natural follow-up questions relevant to the conversation"),
            }),
            execute: async ({ suggestions }) => ({ suggestions, done: true }),
          }),
          report_issue: tool({
            description:
              "Report an equipment issue or maintenance request. Use this when a student describes a problem with a tool or unit.",
            inputSchema: z.object({
              title: z.string().describe("Brief summary of the issue"),
              description: z.string().describe("Detailed description of the problem"),
              unit_label: z
                .string()
                .optional()
                .describe("Unit label if known, e.g. 'Prusa #1'"),
              priority: z
                .enum(["Critical", "High", "Medium", "Low"])
                .default("Medium")
                .describe("Urgency level"),
              reported_by: z
                .string()
                .optional()
                .describe("Student name or NetID if provided"),
            }),
            execute: async ({ title, description, unit_label, priority, reported_by }) => {
              let unitId: string | undefined;
              if (unit_label) {
                const map = await getUnitLabelMap();
                unitId = map.get(unit_label.toLowerCase());
              }

              const record = await createMaintenanceLog({
                title,
                description,
                type: "Issue Report",
                priority,
                status: "Open",
                reported_by: reported_by || undefined,
                unit: unitId ? [unitId] : undefined,
                date_reported: new Date().toISOString().split("T")[0],
              });

              return {
                success: true,
                ticket_id: record.id,
                message: `Issue reported successfully. Ticket ID: ${record.id}`,
              };
            },
          }),
        },
        stopWhen: stepCountIs(5),
      });

      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
