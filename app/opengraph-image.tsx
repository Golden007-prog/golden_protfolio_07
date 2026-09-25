import { ImageResponse } from 'next/og';
import { SITE } from '@/lib/site';
import { headlineFocus, headlineRole } from '@/lib/structured-data';

// Keep alt, size and contentType in step with twitter-image.tsx, which reuses this renderer.
export const alt = `${SITE.name} — ${headlineRole(SITE.headline)}, ${SITE.location}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#FAFAFA';
const SECONDARY = '#CBD5E1';
const MUTED = '#94A3B8';
const BRAND = 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #06B6D4 100%)';
// The site's dark aurora (index.css --app-aurora), a little stronger for a thumbnail.
const AURORA = [
  'radial-gradient(ellipse at 18% 45%, rgba(124, 58, 237, 0.34), transparent 55%)',
  'radial-gradient(ellipse at 85% 15%, rgba(6, 182, 212, 0.22), transparent 50%)',
  'radial-gradient(ellipse at 60% 100%, rgba(236, 72, 153, 0.14), transparent 55%)',
].join(', ');

/** The OB mark from public/ob-logo.svg, rebuilt in boxes so it renders with the card's font. */
function Mark({ size: px }: { size: number }) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: px * 0.22,
        backgroundImage: BRAND,
        color: '#FFFFFF',
        fontSize: px * 0.44,
        letterSpacing: -px * 0.03,
        paddingRight: px * 0.08,
      }}
    >
      OB
      <div
        style={{
          position: 'absolute',
          right: px * 0.1,
          bottom: px * 0.2,
          width: px * 0.11,
          height: px * 0.11,
          borderRadius: px,
          background: '#FFFFFF',
        }}
      />
    </div>
  );
}

export default function OpenGraphImage() {
  const role = headlineRole(SITE.headline);
  const focus = headlineFocus(SITE.headline);
  const host = new URL(SITE.url).host.replace(/^www\./, '');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          backgroundColor: '#060609',
          backgroundImage: AURORA,
          color: INK,
        }}
      >
        <Mark size={88} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 104, lineHeight: 1, letterSpacing: -4 }}>{SITE.name}</div>
          <div style={{ marginTop: 24, fontSize: 44, lineHeight: 1.2, color: SECONDARY }}>{role}</div>
          {focus.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 32 }}>
              {focus.map((f) => (
                <div
                  key={f}
                  style={{
                    display: 'flex',
                    padding: '10px 24px',
                    borderRadius: 999,
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    fontSize: 26,
                    color: SECONDARY,
                  }}
                >
                  {f}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 28, color: MUTED }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 14, height: 14, borderRadius: 14, backgroundImage: BRAND }} />
            {SITE.location}
          </div>
          <div style={{ display: 'flex' }}>{host}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
