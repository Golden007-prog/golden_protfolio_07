import { COREFORGE_BRAND, COREFORGE_PATHS } from '@/lib/coreforge/facts';
import { cfUrl } from '@/lib/coreforge/links';
import { encodeQr, qrSvgPath } from '@/lib/coreforge/qr';
import { QR_COPY } from '@/lib/coreforge/section-copy';
import { cn } from '@/utils/cn';
import { CoreforgeLink } from './CoreforgeLink';

type Props = {
  /** goldensdmat.in path the code opens. */
  path?: string;
  /** utm_campaign for scans; the link under the code uses `${placement}-link`. */
  placement?: string;
  className?: string;
};

const BORDER = 4;

/**
 * A scannable QR code for goldensdmat.in, drawn as one inline SVG path by the
 * dependency-free encoder in src/lib/coreforge/qr.ts. Dark modules on a white field in
 * both themes, since scanners expect that polarity. Pure render: no client code of its own.
 */
export function QRCard({ path = COREFORGE_PATHS.home, placement = 'qr', className }: Props) {
  const qr = encodeQr(cfUrl(path, placement), 'M');
  const box = qr.size + BORDER * 2;
  return (
    <figure data-cf-qr="" className={cn('inline-flex flex-col items-center gap-3 rounded-2xl border border-glass-border bg-glass-fill p-4', className)}>
      <svg
        role="img"
        aria-label={`QR code that opens ${COREFORGE_BRAND.domain}`}
        viewBox={`0 0 ${box} ${box}`}
        shapeRendering="crispEdges"
        className="cf-qr block size-40"
      >
        <path d={qrSvgPath(qr, BORDER)} fill="currentColor" />
      </svg>
      <figcaption className="flex flex-col items-center gap-1 text-center text-xs text-text-muted">
        <span className="font-medium text-text-secondary">{QR_COPY.title}</span>
        <span>{QR_COPY.caption}</span>
        <CoreforgeLink path={path} placement={`${placement}-link`} className="tap-safe-sm text-xs">
          {COREFORGE_BRAND.domain}
        </CoreforgeLink>
      </figcaption>
    </figure>
  );
}

export default QRCard;
