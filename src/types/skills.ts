export interface SkillPaper {
  title: string;
  url: string;
  authors?: string;
}

export interface SkillRepo {
  name: string;
  url: string;
  description: string;
}

export interface SkillDetail {
  name: string;
  category: string;
  shortDef: string;
  purpose: string;
  coreComponents: string[];
  keyCapabilities: string[];
  integrations: string[];
  useCases: string[];
  officialDocs: string;
  researchPapers: SkillPaper[];
  relatedRepos: SkillRepo[];
  heroImage: string;
  videoDemo?: string;
  sources: string[];
}
