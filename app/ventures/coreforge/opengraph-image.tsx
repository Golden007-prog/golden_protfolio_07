import { ImageResponse } from 'next/og';
import { COREFORGE_BRAND, COREFORGE_DISCLAIMER_SHORT, COREFORGE_FREE_PLAN_LINE } from '@/lib/coreforge/facts';
import { VENTURE_COPY } from '@/lib/coreforge/section-copy';
import { SITE } from '@/lib/site';

export const alt = `${COREFORGE_BRAND.product}, the dMAT practice platform founded by ${SITE.name}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Satori paints with literal colours, so these mirror the dark theme and coreforge.css.
const BG = '#060609';
const TEXT = '#FAFAFA';
const TEXT_SECONDARY = '#CBD5E1';
const TEXT_MUTED = '#94A3B8';
const BERRY = '#F0709F';
const BERRY_SOLID = '#A3154F';

export default function Image() {
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
          backgroundImage: 'radial-gradient(circle at 14% 16%, rgba(240, 112, 159, 0.30), transparent 48%), radial-gradient(circle at 90% 90%, rgba(163, 21, 79, 0.32), transparent 52%)',
          color: TEXT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', padding: '8px 18px', borderRadius: 999, border: `1px solid ${BERRY}`, color: BERRY, fontSize: 24 }}>
            Founder
          </div>
          <div style={{ display: 'flex', color: TEXT_MUTED, fontSize: 24 }}>{COREFORGE_BRAND.company}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2, maxWidth: 1040 }}>{VENTURE_COPY.title}</div>
          <div style={{ display: 'flex', fontSize: 32, lineHeight: 1.3, color: TEXT_SECONDARY }}>
            {`${COREFORGE_BRAND.product} · ${COREFORGE_BRAND.tagline} · ${COREFORGE_FREE_PLAN_LINE}`}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', fontSize: 26, color: BERRY }}>{COREFORGE_BRAND.domain}</div>
            <div style={{ display: 'flex', fontSize: 20, color: TEXT_MUTED }}>{COREFORGE_DISCLAIMER_SHORT}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700 }}>{SITE.name}</div>
            <div style={{ display: 'flex', fontSize: 22, color: TEXT_MUTED }}>{host}</div>
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
            backgroundImage: `linear-gradient(90deg, ${BERRY_SOLID}, ${BERRY})`,
          }}
        />
      </div>
    ),
    size,
  );
}
