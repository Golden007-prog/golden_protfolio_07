/*
 * Normalised Kaggle data for the Kaggle section. Every value comes from the
 * Kaggle API or from snapshot.json (captured from it); nothing is derived beyond
 * formatting. Dates are UTC: 'YYYY-MM-DD', or a full ISO date-time where Kaggle
 * gives one (competition deadlines).
 */

export type KaggleSource = 'live' | 'snapshot';

/** A progression tier in one category, e.g. { category: 'Competitions', tier: 'Contributor' }. */
export type KaggleTier = { category: string; tier: string };

export type KaggleProfile = {
  userName: string;
  displayName: string;
  /** https://www.kaggle.com/<userName> */
  url: string;
  /** Absolute avatar URL; '' when Kaggle has none. */
  avatar: string;
  /** 'YYYY-MM-DD' */
  joined: string;
  /** Per-category tiers only. Kaggle's rank_out_of is a population size, not a rank, and is never kept. */
  tiers: KaggleTier[];
  competitionPoints?: number;
  /** Kaggle's headline performance tier, e.g. 'Contributor'. */
  overallTier?: string;
};

export type KaggleBadge = {
  name: string;
  description: string;
  /** 'YYYY-MM-DD' */
  achieved: string;
  /** Absolute image URL (SVG on Kaggle's storage). */
  image: string;
  /** Chosen by the owner in config.ts FEATURED_BADGES; Kaggle has no such flag. */
  featured: boolean;
};

export type KaggleWriteup = {
  title: string;
  /** '' when the writeup has none. */
  subtitle: string;
  /** Human label, e.g. 'Hackathon project', 'Competition solution'. */
  type: string;
  /** Competition title; '' for a writeup not tied to a competition. */
  competition: string;
  /** Absolute competition URL; '' for a writeup not tied to a competition. */
  competitionUrl: string;
  /** Absolute writeup URL. */
  url: string;
  /** 'YYYY-MM-DD' (when Kaggle created the published writeup). */
  published: string;
  /** A verbatim passage from the writeup body (its first prose paragraph, cut at a word boundary); never a paraphrase. */
  excerpt?: string;
  votes?: number;
  /** Slug of the matching project on this site, when there is one (curated in the snapshot). */
  project?: string;
};

export type KaggleCompetition = {
  title: string;
  /** Absolute competition URL. */
  url: string;
  host: string;
  /** Kaggle's category label, e.g. 'Featured', 'Research', 'Community'. */
  category: string;
  /** 'YYYY-MM-DD' or ISO date-time (UTC). A bare date means the end of that UTC day. */
  deadline: string;
  /** Teams on the leaderboard. */
  teams: number;
  /** The owner's leaderboard position. Only ever shown as 'rank N of M teams, as of <rankAsOf>'. */
  userRank?: number;
  /** 'YYYY-MM-DD' the rank was read. Present whenever userRank is. */
  rankAsOf?: string;
  /** Deadline still ahead at the time the data was built. */
  active: boolean;
  summary?: string;
  /** The owner published a writeup for this competition (see KaggleData.writeups). */
  hasWriteup?: boolean;
};

export type KaggleData = {
  source: KaggleSource;
  /** ISO date-time the data was read from Kaggle (the capture time in snapshot mode). */
  fetchedAt: string;
  profile: KaggleProfile;
  badges: KaggleBadge[];
  /** Newest first. */
  writeups: KaggleWriteup[];
  /** Competitions still running, soonest deadline first. */
  active: KaggleCompetition[];
  /** Finished competitions, most recent deadline first. */
  past: KaggleCompetition[];
};
