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
        <Image
          src={tool.imageSrc}
          alt=""
          fill
          sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw"
          style={{ objectFit: "contain" }}
          unoptimized
        />
      </div>
      <div className="tool-card-body">
        <h2>{tool.name}</h2>
        <span className="tool-card-tag">{tool.category}</span>
      </div>
    </Link>
  );
}
