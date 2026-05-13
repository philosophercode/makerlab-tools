import Link from "next/link";

export const metadata = {
  title: "Projects — MakerLab Tools v5",
};

export default function ProjectsPage() {
  return (
    <main className="tool-detail">
      <section className="td-panel td-coming-soon">
        <p className="td-eyebrow">Projects</p>
        <h1>Coming soon</h1>
        <p>
          A gallery of MakerLab projects is in the works — student builds, course outcomes, and
          staff-curated showcases. For now, browse the tool catalog to see what&apos;s available
          in the lab.
        </p>
        <Link className="td-button" href="/">
          Browse tools
        </Link>
      </section>
    </main>
  );
}
