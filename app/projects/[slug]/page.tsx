import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Footer } from '@/components/layout/Footer';
import { SubpageHeader } from '@/components/layout/SubpageHeader';
import { ProjectCaseStudy } from '@/components/projects/ProjectCaseStudy';
import { PROJECTS, getProjectBySlug, githubFacts, hasCaseStudy } from '@/data/projects';
import { SITE } from '@/lib/site';

// Only projects with a real problem statement and approach get a page; the rest
// would be thin copies of their card and live in the home-page dialog instead.
const CASE_STUDIES = PROJECTS.filter(hasCaseStudy);

export const dynamicParams = false;

export function generateStaticParams() {
  return CASE_STUDIES.map((p) => ({ slug: p.slug }));
}

type Props = { params: Promise<{ slug: string }> };

function caseStudyFor(slug: string) {
  const project = getProjectBySlug(slug);
  return project && hasCaseStudy(project) ? project : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = caseStudyFor(slug);
  if (!project) return {};
  const title = `${project.name}: ${project.tagline}`;
  const description = project.problem;
  const path = `/projects/${project.slug}`;
  return {
    title: `${project.name} case study`,
    description,
    alternates: { canonical: path },
    // og:image comes from the colocated opengraph-image.tsx; twitter inherits it.
    openGraph: { type: 'article', url: path, siteName: SITE.name, title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function CaseStudyPage({ params }: Props) {
  const { slug } = await params;
  const project = caseStudyFor(slug);
  if (!project) notFound();

  const url = `${SITE.url}/projects/${project.slug}`;
  const facts = githubFacts(project.slug);
  const index = CASE_STUDIES.indexOf(project);
  const prev = CASE_STUDIES[(index - 1 + CASE_STUDIES.length) % CASE_STUDIES.length];
  const next = CASE_STUDIES[(index + 1) % CASE_STUDIES.length];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: project.name,
    headline: project.tagline,
    description: project.shortDescription,
    abstract: project.problem,
    url,
    codeRepository: project.githubUrl,
    programmingLanguage: project.language,
    keywords: [...project.topics, ...project.techStack].join(', '),
    image: `${SITE.url}${project.thumbnail}`,
    author: { '@type': 'Person', name: SITE.name, url: SITE.url },
    ...(facts?.pushedAt ? { dateModified: facts.pushedAt } : {}),
    ...(facts?.license ? { license: `https://spdx.org/licenses/${facts.license}.html` } : {}),
    ...(project.liveUrl ? { targetProduct: { '@type': 'SoftwareApplication', name: project.name, url: project.liveUrl } } : {}),
  };

  return (
    <>
      <SubpageHeader />
      <main id="main" tabIndex={-1} className="min-h-screen bg-bg-base text-text-primary">
        <script
          type="application/ld+json"
          // Escaped so no string in the data can close the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 sm:pt-10">
          <ProjectCaseStudy project={project} variant="page" titleId="case-study-title" shareUrl={url} />

          <nav aria-label="More case studies" className="mt-4 grid gap-3 border-t border-hairline pt-8 sm:grid-cols-2">
            <Link
              href={`/projects/${prev.slug}`}
              rel="prev"
              className="group flex min-h-11 flex-col gap-1 rounded-2xl border border-hairline bg-surface-tint p-5 ring-focus transition-colors hover:border-violet-bright"
            >
              <span className="flex items-center gap-2 font-mono text-eyebrow uppercase text-text-muted">
                <ArrowLeft aria-hidden="true" className="size-3.5" /> Previous
              </span>
              <span className="font-display text-xl font-semibold text-text-primary">{prev.name}</span>
            </Link>
            <Link
              href={`/projects/${next.slug}`}
              rel="next"
              className="group flex min-h-11 flex-col items-end gap-1 rounded-2xl border border-hairline bg-surface-tint p-5 text-right ring-focus transition-colors hover:border-violet-bright"
            >
              <span className="flex items-center gap-2 font-mono text-eyebrow uppercase text-text-muted">
                Next <ArrowRight aria-hidden="true" className="size-3.5" />
              </span>
              <span className="font-display text-xl font-semibold text-text-primary">{next.name}</span>
            </Link>
          </nav>
        </div>
      </main>
      {/* The footer's oversized wordmark bleeds past narrow viewports; clip it like the home page does. */}
      <div className="overflow-x-clip">
        <Footer />
      </div>
    </>
  );
}
