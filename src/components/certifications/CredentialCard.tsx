'use client';

import { GlassCard } from '@/components/shared/GlassCard';
import { formatIssued, type Certification } from '@/lib/certifications';
import { certCardId, KIND_LABEL } from './data';
import { VerifyLink } from './VerifyLink';

/**
 * One credential: what kind it is (a badge is not a certificate), its title, who
 * issued it and where, a machine-readable issue date, and the issuer's own
 * verification page. Text and tokens only; no third-party logos.
 */
export function CredentialCard({ cert }: { cert: Certification }) {
  const titleId = `${certCardId(cert.id)}-title`;
  return (
    <GlassCard
      as="article"
      spotlight
      tilt={3}
      id={certCardId(cert.id)}
      aria-labelledby={titleId}
      data-cert-card={cert.id}
      data-issuer={cert.issuer}
      data-kind={cert.kind}
      className="cert-card flex h-full flex-col p-5"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-cyan-text">{KIND_LABEL[cert.kind]}</p>
      <h4 id={titleId} className="mt-2 font-display text-lg font-semibold leading-snug text-balance text-text-primary [overflow-wrap:anywhere]">
        {cert.title}
      </h4>
      <p className="mt-1 text-sm text-text-muted">
        <span className="sr-only">Issued by </span>
        {cert.issuer}
        <span aria-hidden="true"> · </span>
        <span className="sr-only"> on </span>
        {cert.platform}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-4">
        <p className="font-mono text-xs text-text-muted">
          <span className="sr-only">Issued </span>
          <time dateTime={cert.issued}>{formatIssued(cert.issued)}</time>
        </p>
        <VerifyLink cert={cert} />
      </div>
    </GlassCard>
  );
}
