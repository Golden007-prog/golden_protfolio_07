/*
 * Pure mapping from Kaggle API payloads to the normalised types in types.ts, plus
 * the rules that decide what the site may show:
 *   - only the owner's items (USERNAME, as owner or writeup collaborator);
 *   - only public, published, non-template writeups; nothing marked private;
 *   - a competition rank only with its team count and an as-of date;
 *   - rank_out_of (a population size) is never read;
 *   - links only ever point at www.kaggle.com, images only at https URLs.
 *
 * No JSON imports and only relative .ts imports, so node --test and
 * scripts/kaggle/snapshot.mjs can load it. Every function takes its data and
 * 'now' as arguments.
 */
import { FEATURED_BADGES, HIDE_WRITEUPS, KAGGLE_ORIGIN, USERNAME, WRITEUP_MIN_VOTES } from './config.ts';
import type {
  KaggleBadge,
  KaggleCompetition,
  KaggleData,
  KaggleProfile,
  KaggleSource,
  KaggleTier,
  KaggleWriteup,
} from './types.ts';

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sameUser = (a: unknown, username: string): boolean => str(a).toLowerCase() === username.toLowerCase();

/** Proto JSON sends int32 as numbers and int64 as strings. */
function int(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d{1,15}$/.test(v.trim())) return Number(v);
  return undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/* ---------------------------------------------------------------------------
 * Dates
 * ------------------------------------------------------------------------- */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

// Kaggle sends up to 7 fractional digits; Date.parse is only specified for 3.
function parseIso(v: unknown): number {
  const s = str(v).replace(/(\.\d{3})\d+/, '$1');
  return s ? Date.parse(s) : NaN;
}

/** 'YYYY-MM-DD' (UTC) from an ISO date or date-time; '' when it does not parse. */
export function isoDay(v: unknown): string {
  const s = str(v);
  if (DAY.test(s)) return Number.isFinite(Date.parse(s)) ? s : '';
  const ms = parseIso(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
}

/** A deadline in ms. A bare 'YYYY-MM-DD' counts until the end of that UTC day. */
export function deadlineMs(deadline: string): number {
  return DAY.test(deadline) ? Date.parse(`${deadline}T23:59:59.999Z`) : parseIso(deadline);
}

export function isActive(deadline: string, now: Date): boolean {
  const ms = deadlineMs(deadline);
  return Number.isFinite(ms) && ms > now.getTime();
}

/** '26 Sep 2026'. Built by hand so server and browser agree whatever their ICU data. */
export function formatDay(v: string): string {
  const d = isoDay(v);
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/* ---------------------------------------------------------------------------
 * URLs and labels
 * ------------------------------------------------------------------------- */

const KAGGLE_HOSTS = new Set(['www.kaggle.com', 'kaggle.com']);

/** https://www.kaggle.com/<path> for a Kaggle path or URL, without query, fragment or trailing slash; '' for anything else. */
export function kaggleUrl(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  let u: URL;
  try {
    u = new URL(s, KAGGLE_ORIGIN);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' || !KAGGLE_HOSTS.has(u.hostname)) return '';
  const path = u.pathname.replace(/\/+$/, '');
  return path ? `${KAGGLE_ORIGIN}${path}` : '';
}

/** The last path segment, lower-cased: a writeup or competition slug. Accepts a URL or a bare slug. */
export function urlSlug(v: string): string {
  const parts = v.split(/[?#]/)[0].split('/').filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function httpsUrl(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  try {
    return new URL(s).protocol === 'https:' ? s : '';
  } catch {
    return '';
  }
}

/** Canonical competition URL from an API url, a Kaggle path or a bare ref slug; '' otherwise. */
function competitionUrl(v: unknown): string {
  const s = str(v);
  if (/^[a-z0-9][a-z0-9-]*$/i.test(s)) return `${KAGGLE_ORIGIN}/competitions/${s}`;
  const u = kaggleUrl(s);
  return /^https:\/\/www\.kaggle\.com\/competitions\/[^/]+$/.test(u) ? u : '';
}

function titleCase(enumName: string): string {
  return enumName
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** 'CONTRIBUTOR' -> 'Contributor'; '' for an unspecified tier. */
export function tierLabel(v: unknown): string {
  const s = str(v).toUpperCase();
  return !s || s.endsWith('UNSPECIFIED') ? '' : titleCase(s);
}

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  COMPETITIONS: 'Competitions',
  DATASETS: 'Datasets',
  NOTEBOOKS: 'Notebooks',
  SCRIPTS: 'Notebooks',
  DISCUSSION: 'Discussions',
  DISCUSSIONS: 'Discussions',
  MODELS: 'Models',
};
const CATEGORY_ORDER = ['Competitions', 'Datasets', 'Notebooks', 'Discussions', 'Models'];

function categoryLabel(v: unknown): string {
  const s = str(v).toUpperCase().replace(/^USER_ACHIEVEMENT_TYPE_/, '');
  if (!s || s.endsWith('UNSPECIFIED')) return '';
  return CATEGORY_LABEL[s] ?? titleCase(s);
}

const categoryRank = (c: string) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
};

const WRITEUP_TYPE_LABEL: Readonly<Record<string, string>> = {
  HACKATHON_PROJECT: 'Hackathon project',
  COMPETITION_SOLUTION: 'Competition solution',
  PERSONAL_PROJECT: 'Personal project',
  KNOWLEDGE: 'Knowledge',
  FORUM_TOPIC: 'Forum topic',
  BLOG: 'Blog',
};

/** 'HACKATHON_PROJECT' -> 'Hackathon project'. */
export function writeupTypeLabel(v: unknown): string {
  const s = str(v).toUpperCase();
  if (!s || s.endsWith('UNSPECIFIED')) return 'Writeup';
  if (WRITEUP_TYPE_LABEL[s]) return WRITEUP_TYPE_LABEL[s];
  const words = s.toLowerCase().replace(/_/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

/**
 * The first prose paragraph of a writeup body, verbatim, cut at a word boundary.
 * Skips headings, tables, code fences and short label lines ('Project name',
 * a team member's name), so a template's form fields never become the excerpt.
 */
export function excerptFrom(text: unknown, max = 220): string | undefined {
  for (const raw of str(text).split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || /^(#|\||```|---|===|<)/.test(trimmed)) continue;
    const line = trimmed
      .replace(/^([-*+]|\d+[.)])\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|`)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (line.length < 60 || !line.includes(' ')) continue;
    if (line.length <= max) return line;
    const cut = line.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
  }
  return undefined;
}

/* ---------------------------------------------------------------------------
 * Kaggle MCP replies
 * ------------------------------------------------------------------------- */

/**
 * The JSON payload of a Kaggle MCP tools/call reply, whether it came back as
 * Server-Sent Events or plain JSON. Null on a JSON-RPC error, on isError (which
 * Kaggle returns with HTTP 200, e.g. 'Unauthenticated') or on anything unparseable.
 */
export function parseMcpToolResult(body: string): unknown {
  const text = body.trim();
  let envelope: unknown;
  if (text.startsWith('{')) {
    envelope = safeJson(text);
  } else {
    const events = text.split(/\r?\n\r?\n/);
    for (let i = events.length - 1; i >= 0 && envelope === undefined; i--) {
      const data = events[i]
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) envelope = safeJson(data);
    }
  }
  if (!isRecord(envelope) || envelope.error !== undefined || !isRecord(envelope.result)) return null;
  const result = envelope.result;
  if (result.isError === true) return null;
  const part = list(result.content).find((c): c is Rec => isRecord(c) && c.type === 'text' && typeof c.text === 'string');
  if (part) return safeJson(part.text as string) ?? null;
  return isRecord(result.structuredContent) ? result.structuredContent : null;
}

/* ---------------------------------------------------------------------------
 * Profile and badges
 * ------------------------------------------------------------------------- */

/** Profile fields the payloads carried; mergeWithSnapshot fills the rest. */
export type ProfilePart = Partial<KaggleProfile> & { userName: string; progressionOptOut?: boolean };

function ownerUserDoc(search: unknown, username: string): Rec | null {
  if (!isRecord(search)) return null;
  const doc = list(search.documents).find(
    (d): d is Rec =>
      isRecord(d) &&
      str(d.documentType) === 'USER' &&
      d.isPrivate !== true &&
      isRecord(d.ownerUser) &&
      sameUser(d.ownerUser.userName, username),
  );
  return doc ?? null;
}

function tiersFrom(summaries: unknown[]): KaggleTier[] {
  const byCategory = new Map<string, string>();
  for (const s of summaries) {
    if (!isRecord(s)) continue;
    const category = categoryLabel(s.summary_type ?? s.summaryType);
    const tier = tierLabel(s.tier);
    if (category && tier && !byCategory.has(category)) byCategory.set(category, tier);
  }
  return [...byCategory]
    .map(([category, tier]) => ({ category, tier }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category));
}

/**
 * The owner's profile from the MCP get_user_profile payload and/or the REST
 * ListEntities USER search. Null when neither is the owner's.
 */
export function normalizeProfile(mcpProfile: unknown, userSearch: unknown, username = USERNAME): ProfilePart | null {
  const mcp = isRecord(mcpProfile) && sameUser(mcpProfile.user_name, username) ? mcpProfile : null;
  const doc = ownerUserDoc(userSearch, username);
  if (!mcp && !doc) return null;
  const owner: Rec = doc && isRecord(doc.ownerUser) ? doc.ownerUser : {};
  const userDoc: Rec = doc && isRecord(doc.userDocument) ? doc.userDocument : {};

  const out: ProfilePart = { userName: username, url: `${KAGGLE_ORIGIN}/${username}` };
  const displayName = str(mcp?.display_name) || str(owner.displayName) || str(doc?.title);
  if (displayName) out.displayName = displayName;
  // documents[].imageUrl arrives double-prefixed and malformed, so it is never used.
  const avatar = httpsUrl(mcp?.user_avatar_url) || httpsUrl(owner.thumbnailUrl);
  if (avatar) out.avatar = avatar;
  const joined = isoDay(mcp?.user_join_date) || isoDay(doc?.createTime);
  if (joined) out.joined = joined;

  if (mcp?.progression_opt_out === true || owner.progressionOptOut === true) {
    out.progressionOptOut = true;
    out.tiers = [];
    return out;
  }
  if (mcp && Array.isArray(mcp.achievement_summaries)) out.tiers = tiersFrom(mcp.achievement_summaries);
  const overall = tierLabel(mcp?.performance_tier) || tierLabel(owner.tier);
  if (overall) out.overallTier = overall;
  const points = int(userDoc.competitionPoints);
  if (points !== undefined && points >= 0) out.competitionPoints = points;
  return out;
}

function badgesHidden(settings: unknown): boolean {
  if (!isRecord(settings)) return false;
  return Object.entries(settings).some(
    ([k, v]) => /badge/i.test(k) && (v === false || /^(hidden|private|only_?me|none)$/i.test(str(v))),
  );
}

/** The MCP get_user_profile payload says the owner hid their badges, so an empty badge list is intended. */
export function profileHidesBadges(mcpProfile: unknown): boolean {
  return isRecord(mcpProfile) && badgesHidden(mcpProfile.visibility_settings);
}

/** Badges from the MCP get_user_profile payload, unsorted and unfeatured. Null when the payload has none to read. */
export function normalizeBadges(mcpProfile: unknown, username = USERNAME): KaggleBadge[] | null {
  if (!isRecord(mcpProfile) || !sameUser(mcpProfile.user_name, username) || !Array.isArray(mcpProfile.badges)) return null;
  if (badgesHidden(mcpProfile.visibility_settings)) return [];
  const out: KaggleBadge[] = [];
  const seen = new Set<string>();
  for (const entry of mcpProfile.badges) {
    if (!isRecord(entry)) continue;
    const badge = isRecord(entry.badge) ? entry.badge : entry;
    const name = str(badge.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      name,
      description: str(badge.description),
      achieved: isoDay(entry.achieved_time ?? entry.achievedTime),
      image: httpsUrl(badge.image_url ?? badge.imageUrl),
      featured: false,
    });
  }
  return out;
}

/** Marks featured badges and sorts: featured first in `featured` order, then newest, then by name. */
export function sortBadges(badges: readonly KaggleBadge[], featured: readonly string[] = FEATURED_BADGES): KaggleBadge[] {
  const order = new Map(featured.map((name, i) => [name.toLowerCase(), i]));
  const pos = (b: KaggleBadge) => order.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  return badges
    .map((b) => ({ ...b, featured: order.has(b.name.toLowerCase()) }))
    .sort((a, b) => pos(a) - pos(b) || b.achieved.localeCompare(a.achieved) || a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------------------------
 * Writeups
 * ------------------------------------------------------------------------- */

function ownsWriteup(doc: Rec, meta: Rec, username: string): boolean {
  if (isRecord(doc.ownerUser) && sameUser(doc.ownerUser.userName, username)) return true;
  return list(meta.collaborators).some((c) => isRecord(c) && sameUser(c.userName, username));
}

/**
 * Writeups from a REST ListEntities TOPIC search. The search is full text, so
 * everything is re-checked here: a TOPIC with writeup metadata, owned by (or
 * co-written by) the user, not private, PUBLISHED and not a template. Null only
 * when the payload is not a search response.
 */
export function normalizeWriteups(search: unknown, username = USERNAME): KaggleWriteup[] | null {
  if (!isRecord(search) || search.error !== undefined) return null;
  const out: KaggleWriteup[] = [];
  const seen = new Set<string>();
  for (const d of list(search.documents)) {
    if (!isRecord(d) || str(d.documentType) !== 'TOPIC' || d.isPrivate === true) continue;
    const disc = isRecord(d.discussionDocument) ? d.discussionDocument : null;
    const meta = disc && isRecord(disc.writeUpMetadata) ? disc.writeUpMetadata : null;
    if (!disc || !meta) continue;
    if (str(meta.contentState) !== 'PUBLISHED' || meta.template === true) continue;
    if (!ownsWriteup(d, meta, username)) continue;

    const url = kaggleUrl(disc.newCommentUrl);
    const title = str(d.title);
    const published = isoDay(d.createTime);
    if (!url.includes('/writeups/') || !title || !published || seen.has(url)) continue;
    seen.add(url);

    const comp: Rec = isRecord(meta.competitionInfo) ? meta.competitionInfo : {};
    const excerpt = excerptFrom(disc.messageStripped);
    out.push({
      title,
      subtitle: str(meta.subtitle),
      type: writeupTypeLabel(meta.type),
      competition: str(comp.competitionTitle),
      competitionUrl: competitionUrl(comp.competitionUrl),
      url,
      published,
      ...(excerpt ? { excerpt } : {}),
      // Proto JSON may omit a zero.
      votes: int(d.votes) ?? 0,
    });
  }
  return out;
}

export type WriteupSelection = {
  /** Default WRITEUP_MIN_VOTES. Writeups with unknown votes always pass. */
  minVotes?: number;
  /** Default HIDE_WRITEUPS: slugs (or URLs) never shown. */
  hide?: readonly string[];
};

export function selectWriteups(
  writeups: readonly KaggleWriteup[],
  { minVotes = WRITEUP_MIN_VOTES, hide = HIDE_WRITEUPS }: WriteupSelection = {},
): KaggleWriteup[] {
  const hidden = new Set(hide.map((h) => urlSlug(h.trim())).filter(Boolean));
  return writeups.filter((w) => !hidden.has(urlSlug(w.url)) && (w.votes === undefined || w.votes >= minVotes));
}

const newestFirst = (a: KaggleWriteup, b: KaggleWriteup) =>
  b.published.localeCompare(a.published) || a.title.localeCompare(b.title);

/* ---------------------------------------------------------------------------
 * Competitions
 * ------------------------------------------------------------------------- */

function normalDeadline(deadline: string): string {
  if (DAY.test(deadline)) return deadline;
  return new Date(parseIso(deadline)).toISOString();
}

/**
 * Competitions from an authenticated ListCompetitions (group ENTERED) reply.
 * A rank is kept only as a whole number within 1..teams, stamped with `asOf`
 * (default: the UTC day of `now`). Null when the payload is not a list reply.
 */
export function normalizeCompetitions(raw: unknown, opts: { now: Date; asOf?: string }): KaggleCompetition[] | null {
  if (!isRecord(raw) || raw.error !== undefined) return null;
  const asOf = isoDay(opts.asOf) || opts.now.toISOString().slice(0, 10);
  const out: KaggleCompetition[] = [];
  const seen = new Set<string>();
  for (const c of list(raw.competitions)) {
    if (!isRecord(c) || c.userHasEntered === false) continue;
    const url = competitionUrl(c.url) || competitionUrl(c.ref);
    const title = str(c.title);
    const deadline = str(c.deadline);
    if (!url || !title || !Number.isFinite(deadlineMs(deadline)) || seen.has(url)) continue;
    seen.add(url);
    const teams = Math.max(0, int(c.teamCount) ?? 0);
    const rank = int(c.userRank);
    const ranked = rank !== undefined && rank >= 1 && rank <= teams;
    const summary = str(c.description);
    out.push({
      title,
      url,
      host: str(c.organizationName) || str(c.hostName),
      category: str(c.category),
      deadline: normalDeadline(deadline),
      teams,
      ...(ranked ? { userRank: rank, rankAsOf: asOf } : {}),
      active: isActive(deadline, opts.now),
      ...(summary ? { summary } : {}),
    });
  }
  return out;
}

/** 'Rank 183 of 3,908 teams, as of 26 Sep 2026', or null when any part is missing or inconsistent. */
export function rankLabel(c: Pick<KaggleCompetition, 'userRank' | 'teams' | 'rankAsOf'>): string | null {
  const { userRank, teams, rankAsOf } = c;
  if (!userRank || !teams || !Number.isInteger(userRank) || userRank < 1 || userRank > teams || !rankAsOf) return null;
  const asOf = formatDay(rankAsOf);
  if (!asOf) return null;
  const n = new Intl.NumberFormat('en-US');
  return `Rank ${n.format(userRank)} of ${n.format(teams)} teams, as of ${asOf}`;
}

/**
 * Splits into running (soonest deadline first) and finished (latest first),
 * recomputing `active` against `now` and `hasWriteup` against `writeups`.
 */
export function splitCompetitions(
  competitions: readonly KaggleCompetition[],
  now: Date,
  writeups: readonly KaggleWriteup[] = [],
): { active: KaggleCompetition[]; past: KaggleCompetition[] } {
  const withWriteup = new Set(writeups.map((w) => urlSlug(w.competitionUrl)).filter(Boolean));
  const all = competitions.map((c) => {
    const next: KaggleCompetition = {
      title: c.title,
      url: c.url,
      host: c.host,
      category: c.category,
      deadline: c.deadline,
      teams: c.teams,
      ...(c.userRank !== undefined && c.rankAsOf ? { userRank: c.userRank, rankAsOf: c.rankAsOf } : {}),
      active: isActive(c.deadline, now),
      ...(c.summary ? { summary: c.summary } : {}),
    };
    if (withWriteup.has(urlSlug(c.url))) next.hasWriteup = true;
    return next;
  });
  const by = (a: KaggleCompetition, b: KaggleCompetition) => deadlineMs(a.deadline) - deadlineMs(b.deadline);
  return {
    active: all.filter((c) => c.active).sort(by),
    past: all.filter((c) => !c.active).sort((a, b) => by(b, a)),
  };
}

/* ---------------------------------------------------------------------------
 * Assembly, snapshot fallback and merging
 * ------------------------------------------------------------------------- */

export type Selection = WriteupSelection & {
  /** Default FEATURED_BADGES. */
  featured?: readonly string[];
  /** false keeps every writeup (used when writing snapshot.json, so un-hiding one later still works). */
  select?: boolean;
};

type Parts = {
  source: KaggleSource;
  fetchedAt: string;
  profile: KaggleProfile;
  badges: readonly KaggleBadge[];
  writeups: readonly KaggleWriteup[];
  competitions: readonly KaggleCompetition[];
};

export function finalize(parts: Parts, now: Date, sel: Selection = {}): KaggleData {
  const chosen = sel.select === false ? [...parts.writeups] : selectWriteups(parts.writeups, sel);
  const writeups = chosen.sort(newestFirst);
  const { active, past } = splitCompetitions(parts.competitions, now, writeups);
  return {
    source: parts.source,
    fetchedAt: parts.fetchedAt,
    profile: parts.profile,
    badges: sortBadges(parts.badges, sel.featured),
    writeups,
    active,
    past,
  };
}

/**
 * Already-finalized data (for example a cached live read) re-split against `now`,
 * so a competition whose deadline passed since the read moves to `past`. The
 * writeup selection was applied when the data was built and is kept as is.
 */
export function resplit(data: KaggleData, now: Date): KaggleData {
  return finalize(
    {
      source: data.source,
      fetchedAt: data.fetchedAt,
      profile: data.profile,
      badges: data.badges,
      writeups: data.writeups,
      competitions: [...data.active, ...data.past],
    },
    now,
    { select: false },
  );
}

/** The snapshot as served: owner config applied, competitions re-split against `now`. */
export function fromSnapshot(snapshot: KaggleData, now: Date, sel: Selection = {}): KaggleData {
  return finalize(
    {
      source: 'snapshot',
      fetchedAt: snapshot.fetchedAt,
      profile: snapshot.profile,
      badges: snapshot.badges,
      writeups: snapshot.writeups,
      competitions: [...snapshot.active, ...snapshot.past],
    },
    now,
    sel,
  );
}

/** Whatever the live calls produced; null means that part was not fetched. */
export type LiveParts = {
  profile: ProfilePart | null;
  badges: KaggleBadge[] | null;
  writeups: KaggleWriteup[] | null;
  competitions: KaggleCompetition[] | null;
};

function mergeProfile(live: ProfilePart | null, snap: KaggleProfile): KaggleProfile {
  if (!live) return snap;
  const merged: KaggleProfile = {
    userName: live.userName,
    displayName: live.displayName || snap.displayName,
    url: live.url || snap.url,
    avatar: live.avatar || snap.avatar,
    joined: live.joined || snap.joined,
    tiers: live.tiers ?? snap.tiers,
  };
  if (live.progressionOptOut) return { ...merged, tiers: [] };
  const points = live.competitionPoints ?? snap.competitionPoints;
  const overall = live.overallTier || snap.overallTier;
  if (points !== undefined) merged.competitionPoints = points;
  if (overall) merged.overallTier = overall;
  return merged;
}

/**
 * Live data with gaps filled from the snapshot. Kaggle's values win for every
 * field it provides; the snapshot fills empty descriptive fields and supplies the
 * curated summary and project link. The excerpt stays the live verbatim passage
 * when Kaggle's body yields one. A competition's team count and rank are never
 * borrowed from the snapshot: both are dated facts, and a live card is dated
 * with the live read.
 */
export function mergeWithSnapshot(
  live: LiveParts,
  snapshot: KaggleData,
  opts: Selection & { now: Date; fetchedAt?: string; source?: KaggleSource },
): KaggleData {
  const snapBadges = new Map(snapshot.badges.map((b) => [b.name.toLowerCase(), b]));
  const snapWriteups = new Map(snapshot.writeups.map((w) => [w.url, w]));
  const snapComps = [...snapshot.active, ...snapshot.past];
  const snapCompsBySlug = new Map(snapComps.map((c) => [urlSlug(c.url), c]));

  const badges = live.badges
    ? live.badges.map((b) => {
        const s = snapBadges.get(b.name.toLowerCase());
        return s ? { ...b, description: b.description || s.description, image: b.image || s.image, achieved: b.achieved || s.achieved } : b;
      })
    : snapshot.badges;

  const writeups = live.writeups
    ? live.writeups.map((w) => {
        const s = snapWriteups.get(w.url);
        if (!s) return w;
        const excerpt = w.excerpt || s.excerpt;
        const votes = w.votes ?? s.votes;
        const out: KaggleWriteup = {
          ...w,
          subtitle: w.subtitle || s.subtitle,
          competition: w.competition || s.competition,
          competitionUrl: w.competitionUrl || s.competitionUrl,
        };
        if (excerpt) out.excerpt = excerpt;
        if (votes !== undefined) out.votes = votes;
        if (s.project) out.project = s.project;
        return out;
      })
    : snapshot.writeups;

  const competitions = live.competitions
    ? live.competitions.map((c) => {
        const s = snapCompsBySlug.get(urlSlug(c.url));
        if (!s) return c;
        const summary = s.summary || c.summary;
        return {
          ...c,
          host: c.host || s.host,
          category: c.category || s.category,
          ...(summary ? { summary } : {}),
        };
      })
    : snapComps;

  return finalize(
    {
      source: opts.source ?? 'live',
      fetchedAt: opts.fetchedAt ?? opts.now.toISOString(),
      profile: mergeProfile(live.profile, snapshot.profile),
      badges,
      writeups,
      competitions,
    },
    opts.now,
    opts,
  );
}

/* ---------------------------------------------------------------------------
 * Snapshot validation
 * ------------------------------------------------------------------------- */

function coerceCompetition(v: unknown): KaggleCompetition[] {
  if (!isRecord(v)) return [];
  const url = competitionUrl(v.url);
  const title = str(v.title);
  const deadline = str(v.deadline);
  if (!url || !title || !Number.isFinite(deadlineMs(deadline))) return [];
  const teams = Math.max(0, int(v.teams) ?? 0);
  const rank = int(v.userRank);
  const asOf = isoDay(v.rankAsOf);
  const summary = str(v.summary);
  return [
    {
      title,
      url,
      host: str(v.host),
      category: str(v.category),
      deadline,
      teams,
      ...(rank !== undefined && rank >= 1 && rank <= teams && asOf ? { userRank: rank, rankAsOf: asOf } : {}),
      active: v.active === true,
      ...(summary ? { summary } : {}),
      ...(v.hasWriteup === true ? { hasWriteup: true } : {}),
    },
  ];
}

/**
 * snapshot.json checked field by field. Malformed entries are dropped, so a bad
 * hand edit degrades the section instead of breaking the page.
 */
export function coerceSnapshot(raw: unknown): KaggleData {
  const r: Rec = isRecord(raw) ? raw : {};
  const p: Rec = isRecord(r.profile) && sameUser(r.profile.userName, USERNAME) ? r.profile : {};
  const points = int(p.competitionPoints);
  const overall = str(p.overallTier);
  const profile: KaggleProfile = {
    userName: USERNAME,
    displayName: str(p.displayName),
    url: `${KAGGLE_ORIGIN}/${USERNAME}`,
    avatar: httpsUrl(p.avatar),
    joined: isoDay(p.joined),
    tiers: list(p.tiers).flatMap((t) =>
      isRecord(t) && str(t.category) && str(t.tier) ? [{ category: str(t.category), tier: str(t.tier) }] : [],
    ),
    ...(points !== undefined && points >= 0 ? { competitionPoints: points } : {}),
    ...(overall ? { overallTier: overall } : {}),
  };

  const badges: KaggleBadge[] = list(r.badges).flatMap((b) =>
    isRecord(b) && str(b.name)
      ? [
          {
            name: str(b.name),
            description: str(b.description),
            achieved: isoDay(b.achieved),
            image: httpsUrl(b.image),
            featured: b.featured === true,
          },
        ]
      : [],
  );

  const writeups: KaggleWriteup[] = list(r.writeups).flatMap((w) => {
    if (!isRecord(w)) return [];
    const url = kaggleUrl(w.url);
    const title = str(w.title);
    const published = isoDay(w.published);
    if (!url.includes('/writeups/') || !title || !published) return [];
    const excerpt = str(w.excerpt);
    const project = str(w.project);
    const votes = int(w.votes);
    return [
      {
        title,
        subtitle: str(w.subtitle),
        type: str(w.type) || 'Writeup',
        competition: str(w.competition),
        competitionUrl: competitionUrl(w.competitionUrl),
        url,
        published,
        ...(excerpt ? { excerpt } : {}),
        ...(votes !== undefined ? { votes } : {}),
        ...(project ? { project } : {}),
      },
    ];
  });

  const fetchedAt = str(r.fetchedAt);
  return {
    source: 'snapshot',
    fetchedAt: Number.isFinite(parseIso(fetchedAt)) ? fetchedAt : '',
    profile,
    badges,
    writeups,
    active: list(r.active).flatMap(coerceCompetition),
    past: list(r.past).flatMap(coerceCompetition),
  };
}
