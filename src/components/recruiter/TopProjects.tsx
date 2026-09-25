'use client';

import { useId, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { PROJECTS } from '@/data/projects';
import type { TopProject } from '@/lib/ai/fit';

const BY_SLUG = new Map(PROJECTS.map((p) => [p.slug, p]));

const CHIP =
  'tap-safe gap-1 rounded-full border border-glass-border px-3 text-xs font-medium text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary';

function Card({ project, onShow }: { project: TopProject; onShow: (slug: string) => void }) {
  const p = BY_SLUG.get(project.slug);
  const [imgOk, setImgOk] = useState(true);
  if (!p) return null;
  return (
    <li data-fit-project={p.slug} className="flex min-w-0 gap-3 rounded-2xl border border-glass-border bg-glass-fill p-3">
      {imgOk && p.thumbnail ? (
        // Thumbnails mix local and GitHub-hosted files at 64px; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.thumbnail}
          alt=""
          width={64}
          height={48}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="h-12 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span aria-hidden="true" className="h-12 w-16 shrink-0 rounded-lg bg-heat-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5 text-text-primary">{p.name}</p>
        {project.quote ? (
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            <span className="sr-only">Why it fits, in the project&apos;s own words: </span>“{project.quote}”
          </p>
        ) : (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{p.tagline}</p>
        )}
        {project.overlap?.length ? <p className="mt-1 text-xs text-text-muted">Named in the JD: {project.overlap.join(', ')}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5" data-fit-noprint="">
          <button type="button" data-cursor="open" onClick={() => onShow(p.slug)} className={CHIP}>
            Show in Projects
          </button>
          <a href={p.githubUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
            Code
            <ArrowUpRight aria-hidden="true" className="size-3" />
            <span className="sr-only"> of {p.name} on GitHub (opens in new tab)</span>
          </a>
        </div>
      </div>
    </li>
  );
}

type Props = { projects: readonly TopProject[]; rankedBy: 'embedding' | 'lexical'; onShow: (slug: string) => void };

/** Three projects for this JD, ranked by embedding similarity or, failing that, by the JD's tech names. */
export function TopProjects({ projects, rankedBy, onShow }: Props) {
  const id = useId();
  const shown = projects.filter((p) => BY_SLUG.has(p.slug)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <section aria-labelledby={`${id}-title`} data-fit-projects={rankedBy} className="fit-block">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
        Top projects for this JD
      </h3>
      <p className="mt-0.5 text-xs text-text-muted">
        {rankedBy === 'embedding' ? 'Ranked by how close each project reads to the JD.' : 'Ranked by how many of their technologies the JD names.'}
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {shown.map((p) => (
          <Card key={p.slug} project={p} onShow={onShow} />
        ))}
      </ul>
    </section>
  );
}
