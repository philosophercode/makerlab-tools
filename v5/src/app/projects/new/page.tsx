import { siteConfig } from "../../../lib/site-config";
import { getCatalogTools } from "../../../lib/catalog";
import { ProjectSubmitForm } from "../../../components/ProjectSubmitForm";

export const metadata = {
  title: `Submit a project — ${siteConfig.name}`,
};

export default async function NewProjectPage() {
  const tools = await getCatalogTools();
  const toolOptions = tools
    .map((tool) => ({ id: tool.id, name: tool.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <ProjectSubmitForm tools={toolOptions} />;
}
