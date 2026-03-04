interface DocLinksProps {
  safety_doc_url: string | null;
  sop_url: string | null;
  video_url: string | null;
}

function LinkItem({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-card-border px-3 py-2 text-sm hover:bg-muted-bg transition-colors"
    >
      <span>{icon}</span>
      <span>{label}</span>
      <svg
        className="ml-auto h-3.5 w-3.5 text-muted"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}

export default function DocLinks({ safety_doc_url, sop_url, video_url }: DocLinksProps) {
  if (!safety_doc_url && !sop_url && !video_url) return null;

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-muted">Documentation</span>
      <div className="space-y-1.5">
        {safety_doc_url && (
          <LinkItem href={safety_doc_url} label="Safety Document" icon="🛡" />
        )}
        {sop_url && (
          <LinkItem href={sop_url} label="Standard Operating Procedure" icon="📋" />
        )}
        {video_url && (
          <LinkItem href={video_url} label="Tutorial Video" icon="🎬" />
        )}
      </div>
    </div>
  );
}
