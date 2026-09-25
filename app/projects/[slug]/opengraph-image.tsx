import { ImageResponse } from 'next/og';
import { PROJECTS, getProjectBySlug, hasCaseStudy } from '@/data/projects';
import { SITE } from '@/lib/site';

export const alt = 'Project case study by Oikantik Basu: name, summary and technologies';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Satori paints with literal colours, so these mirror the dark theme tokens.
const BG = '#060609';
const TEXT = '#FAFAFA';
const TEXT_SECONDARY = '#CBD5E1';
const TEXT_MUTED = '#94A3B8';
const VIOLET = '#7C3AED';
const VIOLET_BRIGHT = '#A855F7';
const CYAN = '#22D3EE';
const MAX_CHIPS = 5;

export function generateStaticParams() {
  return PROJECTS.filter(hasCaseStudy).map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!project || !hasCaseStudy(project)) return new Response('Not found', { status: 404 });

  const host = new URL(SITE.url).host;

  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          backgroundColor: BG,
          backgroundImage: `radial-gradient(circle at 12% 18%, rgba(124, 58, 237, 0.38), transparent 46%), radial-gradient(circle at 92% 88%, rgba(6, 182, 212, 0.28), transparent 50%)`,
          color: TEXT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              padding: '8px 18px',
              borderRadius: 999,
              border: `1px solid ${VIOLET_BRIGHT}`,
              color: VIOLET_BRIGHT,
              fontSize: 24,
            }}
          >
            {project.category}
          </div>
          <div style={{ display: 'flex', color: TEXT_MUTED, fontSize: 24 }}>Case study</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>{project.name}</div>
          <div style={{ display: 'flex', fontSize: 34, lineHeight: 1.3, color: TEXT_SECONDARY, maxWidth: 1000 }}>{project.tagline}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, maxWidth: 820 }}>
            {project.techStack.slice(0, MAX_CHIPS).map((t) => (
              <div
                key={t}
                style={{
                  display: 'flex',
                  padding: '8px 16px',
                  borderRadius: 12,
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: TEXT_SECONDARY,
                  fontSize: 24,
                }}
              >
                {t}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700 }}>{SITE.name}</div>
            <div style={{ display: 'flex', fontSize: 22, color: CYAN }}>{host}</div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 8,
            display: 'flex',
            backgroundImage: `linear-gradient(90deg, ${VIOLET}, ${VIOLET_BRIGHT}, ${CYAN})`,
          }}
        />
      </div>
    ),
    size,
  );
}
