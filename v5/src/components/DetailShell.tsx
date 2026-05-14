import Image from "next/image";
import Link from "next/link";
import type { MakerLabTool, ToolStatus } from "./catalog-types";

interface DetailShellProps {
  tool: MakerLabTool;
}

const STATUS_CHIP: Record<ToolStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  Available: { label: "Available", tone: "success" },
  "In Use": { label: "In Use", tone: "warning" },
  "Training Required": { label: "Training Required", tone: "warning" },
  Offline: { label: "Offline", tone: "danger" },
};

const RESOURCE_TONES: Record<string, "safety" | "sop" | "manual" | "video" | "neutral"> = {
  Safety: "safety",
  SOP: "sop",
  Manual: "manual",
  Video: "video",
};

function resourceTone(kind?: string): "safety" | "sop" | "manual" | "video" | "neutral" {
  if (!kind) return "neutral";
  return RESOURCE_TONES[kind] || "neutral";
}

function resourceLabel(link: MakerLabTool["links"][number]): string {
  if (link.label && !looksLikeUrl(link.label)) return link.label;
  if (link.kind) return link.kind;
  return "Open resource";
}

function looksLikeUrl(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

function formatAcquired(date: string | null): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function findResource(
  tool: MakerLabTool,
  kind: string
): MakerLabTool["links"][number] | undefined {
  return tool.links.find((link) => link.kind === kind);
}

export function DetailShell({ tool }: DetailShellProps) {
  const status = STATUS_CHIP[tool.status];
  const safetyLink = findResource(tool, "Safety");
  const sopLink = findResource(tool, "SOP");

  return (
    <main className="tool-detail">
      <div className="td-breadcrumbs">
        <div>
          <Link href="/">Tools</Link>
          <span aria-hidden="true">›</span>
          <span>Inventory</span>
          <span aria-hidden="true">›</span>
          <span>{tool.name}</span>
        </div>
      </div>

      <section className="td-hero">
        <div className="td-hero-image">
          <Image
            src={tool.imageSrc}
            alt=""
            fill
            sizes="(min-width: 980px) 45vw, 100vw"
            style={{ objectFit: "contain" }}
            priority
          />
        </div>

        <div className="td-hero-copy">
          <h1>{tool.name}</h1>
          <p>{tool.description}</p>

          <div className="td-chip-row" aria-label="Tool status">
            <span className={`td-chip td-chip-${status.tone}`}>
              <span className="td-dot" />
              {status.label}
            </span>
            <span className="td-chip td-chip-warning">
              <span className="td-dot" />
              {tool.trainingLevel} training
            </span>
            {tool.ppe.length > 0 ? (
              <span className="td-chip td-chip-danger">
                <span className="td-dot" />
                PPE Required
              </span>
            ) : null}
            <span className="td-chip">{tool.categorySub || tool.category}</span>
            <span className="td-chip">{tool.zone || tool.location}</span>
          </div>

          <div className="td-actions">
            {safetyLink ? (
              <a className="td-button td-button-primary" href={safetyLink.href}>
                View Safety Doc
              </a>
            ) : null}
            {sopLink ? (
              <a className="td-button" href={sopLink.href}>
                View SOP
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="td-glance" aria-label="At a glance">
        <article className="td-glance-card">
          <p className="td-eyebrow">Materials</p>
          <strong>{tool.materials.length > 0 ? tool.materials.join(", ") : "Contact MakerLab staff"}</strong>
        </article>
      </section>

      <section className="td-panel td-safety">
        <header className="td-section-title td-section-title-danger">
          <h2>Safety &amp; Access</h2>
        </header>

        <div className="td-safety-grid">
          <div className="td-safety-item">
            <h3>PPE Required</h3>
            <div className="td-chip-row">
              {tool.ppe.map((item) => (
                <span className="td-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <p>PPE must be worn before use. Review posted guidelines.</p>
          </div>

          <div className="td-safety-item">
            <h3>Emergency Stop</h3>
            {tool.emergencyStop ? (
              <p>{tool.emergencyStop}</p>
            ) : (
              <p>Follow posted lab guidance and notify staff in an emergency.</p>
            )}
          </div>

          <div className="td-safety-item">
            <h3>Use Restrictions</h3>
            {tool.useRestrictions ? (
              <p>{tool.useRestrictions}</p>
            ) : (
              <p>Open to all trained MakerLab users during lab hours.</p>
            )}
          </div>
        </div>
      </section>

      <section className="td-content-grid">
        <article className="td-panel">
          <header className="td-section-title td-section-title-bordered">
            <h2>Documents &amp; Resources</h2>
          </header>

          {tool.links.length > 0 ? (
            <div className="td-doc-list">
              {tool.links.map((link) => (
                <a className="td-doc" href={link.href} key={`${link.kind}-${link.href}`}>
                  <span className={`td-badge td-badge-${resourceTone(link.kind)}`}>
                    {link.kind || "Resource"}
                  </span>
                  <span className="td-doc-body">
                    <strong>{resourceLabel(link)}</strong>
                    {link.description ? <p>{link.description}</p> : null}
                  </span>
                  <span className="td-doc-arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="td-empty">No documents linked yet.</p>
          )}
        </article>

        <article className="td-panel">
          <header className="td-section-title td-section-title-bordered">
            <h2>Details</h2>
          </header>

          <table className="td-kv-table">
            <tbody>
              <tr>
                <th>Category</th>
                <td>
                  {tool.category}
                  {tool.categorySub ? ` / ${tool.categorySub}` : ""}
                </td>
              </tr>
              <tr>
                <th>Location</th>
                <td>
                  {tool.location}
                  {tool.zone ? ` / ${tool.zone}` : ""}
                </td>
              </tr>
              <tr>
                <th>Materials</th>
                <td>
                  {tool.materials.length > 0 ? tool.materials.join(", ") : "Contact MakerLab staff"}
                </td>
              </tr>
              <tr>
                <th>Training</th>
                <td>{tool.trainingLabel}</td>
              </tr>
              {tool.mapId ? (
                <tr>
                  <th>Map ID</th>
                  <td>
                    <code>{tool.mapId}</code>
                  </td>
                </tr>
              ) : null}
              {tool.tags.length > 0 ? (
                <tr>
                  <th>Tags</th>
                  <td>{tool.tags.join(", ")}</td>
                </tr>
              ) : null}
              {tool.notes ? (
                <tr>
                  <th>Notes</th>
                  <td>{tool.notes}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </article>
      </section>

      {tool.units.length > 0 ? (
        <section className="td-panel">
          <header className="td-section-title td-section-title-bordered">
            <h2>Physical Machines</h2>
          </header>

          <div className="td-machines-scroll">
            <table className="td-machines">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Condition</th>
                  <th>Serial</th>
                  <th>Acquired</th>
                </tr>
              </thead>
              <tbody>
                {tool.units.map((unit) => (
                  <tr key={unit.id}>
                    <td>
                      <strong>{unit.name}</strong>
                      <br />
                      <span className="td-muted">{unit.location}</span>
                    </td>
                    <td>
                      {tool.location}
                      <br />
                      <span className="td-muted">{tool.zone}</span>
                    </td>
                    <td>
                      <span className={`td-status td-status-${unit.status === "Available" ? "ok" : unit.status === "Offline" ? "bad" : "warn"}`}>
                        <span className="td-dot" />
                        {unit.status}
                      </span>
                    </td>
                    <td>
                      <span className={`td-condition td-condition-${unit.condition === "Offline" ? "bad" : unit.condition === "Service Soon" ? "warn" : "ok"}`}>
                        {unit.condition}
                      </span>
                    </td>
                    <td>
                      <code>{unit.serial}</code>
                    </td>
                    <td>{formatAcquired(unit.dateAcquired)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tool.notes ? (
        <section className="td-panel td-notes">
          <header className="td-section-title td-section-title-bordered">
            <h2>Notes &amp; Tips</h2>
          </header>
          <p>{tool.notes}</p>
        </section>
      ) : null}

      <Link className="td-back" href="/">
        ‹ Back to all tools
      </Link>
    </main>
  );
}
