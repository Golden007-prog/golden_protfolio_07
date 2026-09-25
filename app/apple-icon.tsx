import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS masks the corners itself, so the monogram sits on a full-bleed square.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#060609',
          color: '#FAFAFA',
        }}
      >
        <div style={{ position: 'relative', display: 'flex', fontSize: 88, letterSpacing: -4, lineHeight: 1 }}>
          OB
          <div
            style={{
              position: 'absolute',
              right: -22,
              bottom: 6,
              width: 16,
              height: 16,
              borderRadius: 16,
              backgroundImage: 'linear-gradient(135deg, #A855F7, #06B6D4)',
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
