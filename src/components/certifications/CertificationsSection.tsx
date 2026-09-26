'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { CountUp, Reveal, Stagger, StaggerItem } from '@/components/motion';
import { revealVariants } from '@/components/motion/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Button } from '@/components/ui/Button';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { formatIssued, getCertification, type Certification, type CertificationGroup } from '@/lib/certifications';
import { duration as DURATION, ease, staggerContainer, stagger as STAGGER } from '@/lib/motion';
import { cn } from '@/utils/cn';
import { CredentialCard } from './CredentialCard';
import {
  ALL_ISSUERS,
  CERTS,
  certCardId,
  COUNTS,
  FEATURED,
  groupOf,
  ISSUER_OPTIONS,
  KIND_COUNTS,
  kindPhrase,
  matchesIssuer,
  REST,
  type IssuerFilter as Filter,
} from './data';
import { FeaturedCertificate } from './FeaturedCertificate';
import { IssuerFilter } from './IssuerFilter';
import { onRevealCredential } from './reveal';

/** A group longer than this folds to its first row on phones (the Claude Academy badges). */
const COLLAPSE_AFTER = 8;
const ANNOUNCE_DELAY_MS = 300;
/** Long enough for a filter's exit and a group's height animation to settle before scrolling to a card. */
const SETTLE_MS = DURATION.base * 1000 + 80;
const FLASH_MS = 2400;

const GROUP_ENTER = { opacity: 1, y: 0 };
const GROUP_HIDDEN = { opacity: 0, y: 16 };
const GROUP_EXIT = { opacity: 0, y: -8, transition: { duration: DURATION.quick, ease: ease.in } };
const ITEM_EXIT = { opacity: 0, scale: 0.96, transition: { duration: DURATION.quick, ease: ease.in } };

function groupSummary(items: readonly Certification[]): string {
  const kinds = new Set(items.map((c) => c.kind));
  const [only] = kinds;
  return kinds.size === 1 && only ? `${items.length} ${kindPhrase(only, items.length)}` : `${items.length} credentials`;
}

type GroupProps = {
  group: CertificationGroup;
  filter: Filter;
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
};

/**
 * One platform's credentials as a grid. Filtering removes cards with a short
 * exit while the rest glide into place. A long group folds to its first row on
 * phones (CSS, keyed to data-collapsed) behind a 'Show all N' button; opening it
 * moves focus to the first card that appeared.
 */
function CredentialGroup({ group, filter, expanded, onExpandedChange }: GroupProps) {
  const { reduce, lite } = useMotionPrefs();
  const listRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLElement>(null);
  const [revealing, setRevealing] = useState(false);
  const items = group.items.filter((c) => matchesIssuer(c, filter));
  const headingId = `cert-group-${group.id}-title`;
  const listId = `cert-group-${group.id}-list`;
  const collapsible = group.items.length > COLLAPSE_AFTER && filter === ALL_ISSUERS;
  const collapsed = collapsible && !expanded;

  const container = useMemo<Variants>(
    () => (reduce ? { hidden: {}, visible: {} } : staggerContainer(STAGGER.micro)),
    [reduce],
  );
  const itemVariants = useMemo(() => revealVariants('fade-up', reduce, 0, lite), [reduce, lite]);

  useEffect(() => {
    if (!revealing) return;
    const t = window.setTimeout(() => setRevealing(false), 900);
    return () => window.clearTimeout(t);
  }, [revealing]);

  const toggle = () => {
    const list = listRef.current;
    if (!collapsed) {
      onExpandedChange(false);
      // The list shrinks above the button, so bring the button (and focus) back into view.
      requestAnimationFrame(() => toggleRef.current?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    const hiddenBefore = list ? Array.from(list.children).filter((li) => li.getClientRects().length === 0) : [];
    flushSync(() => {
      onExpandedChange(true);
      setRevealing(true);
    });
    hiddenBefore[0]?.querySelector<HTMLElement>('[data-verify-link]')?.focus({ preventScroll: true });
  };

  return (
    <motion.section
      aria-labelledby={headingId}
      data-cert-group={group.id}
      initial={GROUP_HIDDEN}
      animate={GROUP_ENTER}
      exit={GROUP_EXIT}
      transition={{ duration: DURATION.base, ease: ease.out }}
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="font-display text-h3 font-semibold text-text-primary">
          {group.label}
        </h3>
        <p data-cert-group-count="" className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">
          {groupSummary(items)}
        </p>
      </div>

      <motion.ul
        ref={listRef}
        id={listId}
        data-collapsed={collapsed ? '' : undefined}
        data-revealing={revealing ? '' : undefined}
        className="cert-grid relative grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        variants={container}
        initial="hidden"
        animate={reduce ? 'visible' : undefined}
        whileInView={reduce ? undefined : 'visible'}
        viewport={{ once: true, amount: 'some', margin: '100000px 0px -64px 0px' }}
      >
        {/* initial stays on: it gives these cards their own presence context, so they start
            hidden and cascade in on scroll even though the group itself mounts with initial off. */}
        <AnimatePresence mode="popLayout">
          {items.map((c, i) => (
            <motion.li
              key={c.id}
              layout={reduce ? false : 'position'}
              variants={itemVariants}
              exit={ITEM_EXIT}
              data-reveal=""
              className="min-w-0"
              style={{ '--i': i } as CSSProperties}
            >
              <CredentialCard cert={c} />
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      {collapsible ? (
        <div className="mt-5 sm:hidden">
          <Button
            ref={toggleRef}
            variant="secondary"
            size="md"
            aria-expanded={!collapsed}
            aria-controls={listId}
            data-cert-collapse-toggle={group.id}
            onClick={toggle}
            trailingIcon={<ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform duration-300', !collapsed && 'rotate-180')} />}
          >
            {collapsed ? `Show all ${items.length}` : 'Show fewer'}
            <span className="sr-only"> {group.label} credentials</span>
          </Button>
        </div>
      ) : null}
    </motion.section>
  );
}

/** Marks a card for a moment after a palette jump (certifications.css draws the ring). */
function flash(el: HTMLElement) {
  el.removeAttribute('data-cert-flash');
  void el.offsetWidth;
  el.setAttribute('data-cert-flash', '');
  window.setTimeout(() => el.removeAttribute('data-cert-flash'), FLASH_MS);
}

/**
 * Every credential, each linked to the issuer's own verification page. The
 * professional certificate leads and opens to its courses; the rest sit in one
 * grid per platform. The counts, the issuer chips and every date are read from
 * certifications.json, never typed in.
 */
export function CertificationsSection() {
  const [filter, setFilter] = useState<Filter>(ALL_ISSUERS);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const touched = useRef(false);

  const showFeatured = FEATURED !== null && (FEATURED.lead ? matchesIssuer(FEATURED.lead, filter) : false);
  const groups = REST.filter((g) => g.items.some((c) => matchesIssuer(c, filter)));

  const changeFilter = (next: Filter) => {
    touched.current = true;
    setFilter(next);
  };

  // What the filter shows, once it settles; silent until the visitor first uses it.
  useEffect(() => {
    if (!touched.current) return;
    const count = CERTS.items.filter((c) => matchesIssuer(c, filter)).length;
    const label = ISSUER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
    const text = filter === ALL_ISSUERS ? `Showing all ${count} credentials` : `Showing ${count} ${count === 1 ? 'credential' : 'credentials'} from ${label}`;
    const t = window.setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [filter]);

  // The palette's 'show me this credential': clear a filter hiding it, open what folds it away, then go there.
  useEffect(
    () =>
      onRevealCredential((id) => {
        const cert = getCertification(CERTS, id);
        const group = groupOf(id);
        if (!cert || !group) return;
        setFilter((f) => (matchesIssuer(cert, f) ? f : ALL_ISSUERS));
        if (group === FEATURED && group.lead?.id !== id) setCoursesOpen(true);
        if (group.items.length > COLLAPSE_AFTER) setExpanded((s) => new Set(s).add(group.id));
        setReveal((r) => ({ id, n: (r?.n ?? 0) + 1 }));
      }),
    [],
  );

  useEffect(() => {
    if (!reveal) return;
    const t = window.setTimeout(
      () => {
        const card = document.getElementById(certCardId(reveal.id));
        if (!card) return;
        smoothScrollTo(card, { focus: false, immediate: getMotionPrefs().reduce });
        flash(card);
        card.querySelector<HTMLElement>('[data-verify-link]')?.focus({ preventScroll: true });
      },
      getMotionPrefs().reduce ? 0 : SETTLE_MS,
    );
    return () => window.clearTimeout(t);
  }, [reveal]);

  const setGroupExpanded = (id: string, next: boolean) =>
    setExpanded((s) => {
      const out = new Set(s);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });

  return (
    <SectionWrapper id="certifications">
      <SectionHeading
        sectionId="certifications"
        title="Credentials you can *verify*."
        subtitle="Every badge and certificate below links to the issuer's own verification page."
      />

      <Reveal className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p data-cert-total="" className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="bg-gradient-to-r from-violet-bright to-cyan-bright bg-clip-text font-display text-[clamp(3.5rem,2.5rem_+_5vw,6rem)] font-bold leading-none tracking-tight text-transparent">
              <CountUp value={COUNTS.total} duration={1.2} />
            </span>
            <span className="text-lead font-medium text-text-secondary">verified credentials</span>
          </p>
          <p data-cert-meta="" className="mt-3 text-sm text-text-muted">
            From {COUNTS.issuers} issuers on {COUNTS.platforms} platforms
            <span aria-hidden="true"> · </span>
            <span className="sr-only">. </span>
            links checked <time dateTime={CERTS.verifiedAt}>{formatIssued(CERTS.verifiedAt)}</time>
          </p>
        </div>
        <Stagger as="ul" stagger={STAGGER.micro} className="flex flex-wrap gap-2 lg:justify-end">
          {KIND_COUNTS.map(({ kind, count }) => (
            <StaggerItem
              as="li"
              key={kind}
              variant="fade"
              className="rounded-full border border-glass-border bg-surface-tint px-3 py-1 text-xs"
            >
              <span className="font-semibold tabular-nums text-text-primary">{count}</span>{' '}
              <span className="text-text-muted">{kindPhrase(kind, count)}</span>
            </StaggerItem>
          ))}
        </Stagger>
      </Reveal>

      <IssuerFilter value={filter} onChange={changeFilter} className="mb-10 md:mb-12" />
      <p aria-live="polite" aria-atomic="true" data-cert-status="" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-col gap-14 md:gap-16">
        <AnimatePresence initial={false}>
          {showFeatured && FEATURED?.lead ? (
            <motion.div
              key={FEATURED.id}
              initial={GROUP_HIDDEN}
              animate={GROUP_ENTER}
              exit={GROUP_EXIT}
              transition={{ duration: DURATION.base, ease: ease.out }}
            >
              <FeaturedCertificate
                group={FEATURED as CertificationGroup & { lead: Certification }}
                open={coursesOpen}
                onToggle={() => setCoursesOpen((v) => !v)}
              />
            </motion.div>
          ) : null}
          {groups.map((g) => (
            <CredentialGroup
              key={g.id}
              group={g}
              filter={filter}
              expanded={expanded.has(g.id)}
              onExpandedChange={(next) => setGroupExpanded(g.id, next)}
            />
          ))}
        </AnimatePresence>
      </div>
    </SectionWrapper>
  );
}
