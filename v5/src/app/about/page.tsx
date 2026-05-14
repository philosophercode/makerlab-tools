import Link from "next/link";

export const metadata = {
  title: "About — MakerLab Tools v5",
};

export default function AboutPage() {
  return (
    <main className="tool-detail">
      <section className="td-panel td-prose">
        <p className="td-eyebrow">About</p>
        <h1>A student-led catalog for the Cornell Tech MakerLab.</h1>

        <p>
          MakerLab Tools is a digital inventory and discovery system for the Cornell Tech
          MakerLab. It helps students browse equipment, find safety documentation, and
          identify which physical machines are available in the lab before they walk over.
        </p>

        <p>
          The project began as a weekend prototype and grew into the current Notion-backed
          catalog. Tools, units, locations, and resources all live in Notion and feed the
          site through a cached read-only API layer — so staff and student volunteers can
          curate content without touching code.
        </p>

        <h2>Built by</h2>
        <p>
          <strong>Isaac Steinberg</strong>, Johnson Cornell Tech MBA &apos;26. Built as a
          student-led project to make it easier for the MakerLab community to find and
          safely use the lab&apos;s equipment.
        </p>

        <h2>How it works</h2>
        <p>
          The front end is a Next.js 16 app deployed on Vercel. The Notion API serves as
          the source of truth for the catalog, with a per-request cache layer so the page
          stays fast under load. Tool images are mirrored locally so they render reliably
          even when upstream signed URLs expire.
        </p>

        <p>
          If you spot a mistake or have a suggestion, talk to the MakerLab staff — flagged
          corrections are reviewed and updated in Notion.
        </p>

        <div className="td-prose-actions">
          <Link className="td-button" href="/">
            Browse tools
          </Link>
        </div>
      </section>
    </main>
  );
}
