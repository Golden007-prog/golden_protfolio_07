'use client';

import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Award, ChevronDown } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { Button } from '@/components/ui/Button';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { formatIssued, type Certification, type CertificationGroup } from '@/lib/certifications';
import { duration as DURATION, ease, stagger as STAGGER } from '@/lib/motion';
import { cn } from '@/utils/cn';
import { certCardId, KIND_LABEL } from './data';
import { VerifyLink } from './VerifyLink';

type Props = {
  group: CertificationGroup & { lead: Certification };
  open: boolean;
  onToggle: () => void;
};

/**
 * The professional certificate as the lead card. It opens to the courses that
 * make it up, in the order the certificate lists them, each with its own Verify
 * link. The courses stay in the DOM while closed (inert, zero height), so every
 * credential on the page is always one element with a stable id.
 */
export function FeaturedCertificate({ group, open, onToggle }: Props) {
  const { lead } = group;
  const { reduce } = useMotionPrefs();
  const baseId = useId();
  const regionId = `${baseId}-courses`;
  const titleId = `${certCardId(lead.id)}-title`;

  // The certificate's own course order; anything it does not list follows, newest first.
  const courses = useMemo(() => {
    const order = lead.includes ?? [];
    const rank = (c: Certification) => {
      const i = order.indexOf(c.title);
      return i === -1 ? order.length : i;
    };
    return [...group.items].sort((a, b) => rank(a) - rank(b));
  }, [group.items, lead.includes]);
  const n = courses.length;

  return (
    <GlassCard
      as="article"
      strong
      spotlight
      glow="violet"
      id={certCardId(lead.id)}
      aria-labelledby={titleId}
      data-cert-card={lead.id}
      data-cert-featured=""
      data-issuer={lead.issuer}
      data-kind={lead.kind}
      className="cert-featured p-6 md:p-10"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-glass-border bg-surface-tint px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-amber-text">
              <Award aria-hidden="true" className="size-3.5 shrink-0" />
              {KIND_LABEL[lead.kind]}
            </span>
            <span className="text-sm text-text-muted">
              <span className="sr-only">Issued by </span>
              {lead.issuer}
              <span aria-hidden="true"> · </span>
              <span className="sr-only"> on </span>
              {lead.platform}
            </span>
          </div>
          <h3 id={titleId} className="mt-4 font-display text-h3 font-semibold text-balance text-text-primary">
            {lead.title}
          </h3>
          <p className="mt-2 font-mono text-xs text-text-muted">
            <span className="sr-only">Issued </span>
            <time dateTime={lead.issued}>{formatIssued(lead.issued)}</time>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {n} {n === 1 ? 'course' : 'courses'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:shrink-0 lg:justify-end">
          <VerifyLink cert={lead} variant="primary" size="md" />
          {n > 0 ? (
            <Button
              variant="secondary"
              aria-expanded={open}
              aria-controls={regionId}
              onClick={onToggle}
              data-cert-courses-toggle=""
              trailingIcon={<ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform duration-300', open && 'rotate-180')} />}
            >
              {open ? 'Hide' : 'Show'} the {n} {n === 1 ? 'course' : 'courses'}
            </Button>
          ) : null}
        </div>
      </div>

      <motion.div
        id={regionId}
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={reduce ? { duration: 0 } : { duration: DURATION.base, ease: ease.out }}
        inert={!open}
        data-cert-courses=""
        className="overflow-clip"
      >
        <ol aria-label={`Courses in the ${lead.title}`} className="mt-8 grid grid-cols-1 gap-3 border-t border-hairline pt-8 md:grid-cols-2">
          {courses.map((c, i) => (
            <motion.li
              key={c.id}
              initial={false}
              animate={open ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={
                reduce ? { duration: 0 } : { duration: DURATION.base, ease: ease.out, delay: open ? 0.08 + i * STAGGER.micro : 0 }
              }
              className="min-w-0"
            >
              <article
                id={certCardId(c.id)}
                aria-labelledby={`${certCardId(c.id)}-title`}
                data-cert-card={c.id}
                data-issuer={c.issuer}
                data-kind={c.kind}
                className="flex h-full flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-hairline bg-surface-tint py-3 pl-4 pr-3"
              >
                <div className="flex min-w-0 flex-1 items-baseline gap-3">
                  <span aria-hidden="true" className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-text-dim">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h4
                      id={`${certCardId(c.id)}-title`}
                      className="font-display text-base font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]"
                    >
                      {c.title}
                    </h4>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                      <span className="sr-only">{KIND_LABEL[c.kind]}, issued </span>
                      <time dateTime={c.issued}>{formatIssued(c.issued)}</time>
                    </p>
                  </div>
                </div>
                <VerifyLink cert={c} />
              </article>
            </motion.li>
          ))}
        </ol>
      </motion.div>
    </GlassCard>
  );
}
