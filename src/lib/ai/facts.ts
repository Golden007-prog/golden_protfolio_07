/*
 * Deterministic fact tools the AI features call instead of letting a model do
 * date arithmetic or guess at logistics. They reuse the pure month helpers in
 * src/utils/dates.ts.
 *
 * experienceSpans() gives each role's duration and the union of the date ranges:
 * the Mindrift and iHUB roles overlap, so summing them would double-count. It
 * deliberately produces no total-years sentence.
 *
 * Pure: relative .ts imports only; data is passed in.
 */
import { compareYearMonth, formatDuration, formatYearMonth, monthsBetween, parseYearMonth } from '../../utils/dates.ts';

export type FactExperience = { company: string; role: string; start?: string | null; end?: string | null };
export type FactEducation = { degree: string; institution: string; start?: string | null; end?: string | null; status: string };
export type FactProfile = {
  location: string;
  availability: { status: string; focus: string; openTo: string };
  education: readonly FactEducation[];
};

export type SpanRow = { company: string; role: string; months: number; label: string };

function monthIndex(ym: string | null | undefined): number | null {
  const p = parseYearMonth(ym);
  return p ? p.year * 12 + (p.month - 1) : null;
}

/**
 * Per-role months (both end months counted, open roles running to `todayYM`)
 * and the number of distinct calendar months covered by any role.
 */
export function experienceSpans(exp: readonly FactExperience[], todayYM: string): { rows: SpanRow[]; unionMonths: number } {
  const covered = new Set<number>();
  const rows = exp.map((e) => {
    const until = e.end ?? todayYM;
    const months = monthsBetween(e.start, until) ?? 0;
    const from = monthIndex(e.start);
    const to = monthIndex(until);
    if (months > 0 && from !== null && to !== null) for (let m = from; m <= to; m++) covered.add(m);
    return { company: e.company, role: e.role, months, label: formatDuration(months) };
  });
  return { rows, unionMonths: covered.size };
}

/** Availability exactly as the profile states it. */
export function availability(profile: Pick<FactProfile, 'availability'>): {
  status: string;
  focus: string;
  openTo: string;
  sourceId: 'profile:availability';
} {
  const { status, focus, openTo } = profile.availability;
  return { status, focus, openTo, sourceId: 'profile:availability' };
}

export type LogisticsKind = 'location' | 'remote' | 'type' | 'visa' | 'notice' | 'salary' | 'relocation' | 'start';

/**
 * A verbatim answer for the logistics the site states (location, remote and
 * employment type, from profile:availability), else { answer: null }, which the
 * UI words as 'Not stated on this site'.
 */
export function logistics(kind: LogisticsKind, profile: Pick<FactProfile, 'location' | 'availability'>): {
  answer: string | null;
  sourceId?: string;
} {
  switch (kind) {
    case 'location':
      return { answer: profile.location, sourceId: 'profile:availability' };
    case 'remote':
    case 'type':
      return { answer: profile.availability.openTo, sourceId: 'profile:availability' };
    default:
      return { answer: null };
  }
}

const IN_PROGRESS = /in progress|pursuing|ongoing/i;

/**
 * Each degree with whether it is held. A degree whose status says it is in
 * progress, or whose end is after `todayYM` when given, is not held.
 */
export function educationStatus(
  profile: Pick<FactProfile, 'education'>,
  todayYM?: string,
): { index: number; degree: string; institution: string; held: boolean; label: string }[] {
  return profile.education.map((e, index) => {
    const pending = IN_PROGRESS.test(e.status) || (todayYM ? compareYearMonth(e.end, todayYM) === 1 : false);
    const end = formatYearMonth(e.end);
    const label = pending
      ? `In progress${end ? ` · Expected ${end}` : ''}`
      : [end ? `Completed ${end}` : 'Completed', e.status].filter(Boolean).join(' · ');
    return { index, degree: e.degree, institution: e.institution, held: !pending, label };
  });
}
