import Image from "next/image";
import Link from "next/link";
import type { MakerLabTool } from "./catalog-types";

interface ToolCardProps {
  tool: MakerLabTool;
}

export function ToolCard({ tool }: ToolCardProps) {
  const isInUse = tool.status === "In Use";

  return (
    <Link className="tool-card" href={`/tools/${tool.slug}`}>
      {isInUse ? <span className="card-status-dot" aria-label="In use" /> : null}
      <div className="tool-card-image">
        <Image src={tool.imageSrc} alt="" fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" />
      </div>
      <div className="tool-card-body">
        <div>
          <p className="eyebrow">{tool.category}</p>
          <h2>{tool.name}</h2>
        </div>
        <p>{tool.shortDescription}</p>
        <dl className="metadata-strip">
          <div>
            <dt>&gt; TRAINING:</dt>
            <dd>{tool.trainingLevel}</dd>
          </div>
          <div>
            <dt>&gt; ZONE:</dt>
            <dd>{tool.zone}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
