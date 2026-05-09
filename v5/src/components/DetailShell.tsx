import Image from "next/image";
import type { MakerLabTool } from "./catalog-types";
import { TechnicalFrame } from "./TechnicalFrame";
import { UnitsList } from "./UnitsList";

interface DetailShellProps {
  tool: MakerLabTool;
}

export function DetailShell({ tool }: DetailShellProps) {
  return (
    <main className="page-shell detail-shell">
      <TechnicalFrame className="detail-hero">
        <div className="detail-image">
          <Image src={tool.imageSrc} alt="" fill sizes="(min-width: 860px) 45vw, 100vw" />
        </div>
        <div className="detail-hero-copy">
          <p className="eyebrow">
            {tool.category} {"//"} {tool.zone}
          </p>
          <h1>{tool.name}</h1>
          <p>{tool.description}</p>
          <div className="detail-actions">
            {tool.links.map((link) => (
              <a className="doc-chip" href={link.href} key={link.label}>
                {link.kind ? <span>{link.kind}</span> : null}
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </TechnicalFrame>

      <section className="detail-grid">
        <div className="detail-panel">
          <div className="section-heading">
            <p className="eyebrow">SPECIFICATION</p>
            <h2>Machine Data</h2>
          </div>
          <dl className="spec-table">
            {tool.specs.map((spec) => (
              <div key={spec.label}>
                <dt>{spec.label}</dt>
                <dd>{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="detail-panel safety-panel">
          <div className="section-heading">
            <p className="eyebrow">SAFETY STAMP</p>
            <h2>PPE Required</h2>
          </div>
          <div className="ppe-list">
            {tool.ppe.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      <UnitsList units={tool.units} />
    </main>
  );
}
