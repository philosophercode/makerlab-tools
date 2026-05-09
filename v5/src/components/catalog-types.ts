export type ToolStatus = "Available" | "In Use" | "Training Required" | "Offline";

export interface MakerLabUnit {
  id: string;
  name: string;
  serial: string;
  status: ToolStatus;
  condition: "Excellent" | "Good" | "Service Soon" | "Offline";
  location: string;
}

export interface MakerLabTool {
  id: string;
  slug: string;
  name: string;
  category: string;
  location: string;
  zone: string;
  trainingLevel: "Beginner" | "Intermediate" | "Advanced";
  status: ToolStatus;
  shortDescription: string;
  description: string;
  imageSrc: string;
  ppe: string[];
  specs: Array<{
    label: string;
    value: string;
  }>;
  links: Array<{
    label: string;
    href: string;
    kind?: string;
    description?: string;
  }>;
  units: MakerLabUnit[];
}

export interface CatalogStats {
  toolsOnline: number;
  awaitingTraining: number;
  labHours: string;
}
