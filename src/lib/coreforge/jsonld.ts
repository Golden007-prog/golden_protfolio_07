/*
 * JSON-LD for GOLDEN's Coreforge and CoreForge, for the SEO stage to add to the site
 * graph (or render on its own with buildCoreforgeJsonLd). The founder is a reference
 * to the portfolio's Person node, whose @id structured-data.ts builds as
 * `${SITE.url}/#person`. Deliberately absent: aggregateRating, review and any
 * price or currency, even the Free plan's zero, because goldensdmat.in publishes
 * no ratings and the portfolio states no prices; the Offer points at /pricing.
 * Pure, so node --test can import it.
 */
import {
  COREFORGE_BRAND,
  COREFORGE_DISCLAIMER,
  COREFORGE_FEATURES,
  COREFORGE_FREE_PLAN_LINE,
  COREFORGE_PATHS,
  COREFORGE_POSITIONING,
  coreforgeAbsoluteUrl,
} from './facts.ts';

export type JsonLdNode = { '@type': string; '@id'?: string } & Record<string, unknown>;

export const COREFORGE_ORG_ID = `${COREFORGE_BRAND.origin}/#organization`;
export const COREFORGE_APP_ID = `${COREFORGE_BRAND.origin}/#app`;
/** Matches structured-data.ts's person id for SITE.url 'https://www.basuoikantik.in'. */
export const PORTFOLIO_PERSON_ID = 'https://www.basuoikantik.in/#person';

type Options = { founderId?: string };

/**
 * The organisation's description wherever a graph names it, so the site-wide graph
 * (structured-data.ts) and the venture page describe the one @id the same way.
 */
export const COREFORGE_ORG_COPY = {
  description: `The maker of ${COREFORGE_BRAND.product}, a practice platform for the dMAT (digitaler Mastertest) for applicants to German Master’s programmes.`,
  disambiguatingDescription: COREFORGE_DISCLAIMER,
} as const;

export function buildCoreforgeOrganization({ founderId = PORTFOLIO_PERSON_ID }: Options = {}): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': COREFORGE_ORG_ID,
    name: COREFORGE_BRAND.company,
    url: COREFORGE_BRAND.origin,
    image: COREFORGE_BRAND.ogImage,
    ...COREFORGE_ORG_COPY,
    founder: { '@id': founderId },
    brand: { '@type': 'Brand', name: COREFORGE_BRAND.product },
  };
}

export function buildCoreforgeApp(): JsonLdNode {
  return {
    '@type': 'WebApplication',
    '@id': COREFORGE_APP_ID,
    name: COREFORGE_BRAND.product,
    alternateName: `${COREFORGE_BRAND.product} ${COREFORGE_BRAND.tagline}`,
    url: coreforgeAbsoluteUrl(COREFORGE_PATHS.home),
    description: COREFORGE_POSITIONING,
    disambiguatingDescription: COREFORGE_DISCLAIMER,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web browser',
    inLanguage: 'en',
    image: COREFORGE_BRAND.ogImage,
    publisher: { '@id': COREFORGE_ORG_ID },
    creator: { '@id': COREFORGE_ORG_ID },
    audience: {
      '@type': 'EducationalAudience',
      educationalRole: 'student',
      audienceType: 'Applicants to German Master’s programmes',
    },
    featureList: COREFORGE_FEATURES.map((f) => f.title),
    offers: {
      '@type': 'Offer',
      name: 'Free plan',
      description: COREFORGE_FREE_PLAN_LINE,
      url: coreforgeAbsoluteUrl(COREFORGE_PATHS.pricing),
    },
  };
}

/** Both nodes, for splicing into an existing '@graph'. */
export function buildCoreforgeNodes(options: Options = {}): JsonLdNode[] {
  return [buildCoreforgeOrganization(options), buildCoreforgeApp()];
}

/** A standalone document for a page that renders only CoreForge's graph. */
export function buildCoreforgeJsonLd(options: Options = {}): { '@context': 'https://schema.org'; '@graph': JsonLdNode[] } {
  return { '@context': 'https://schema.org', '@graph': buildCoreforgeNodes(options) };
}

/** Properties to merge into the portfolio's Person node so the link runs both ways. */
export function coreforgeFounderLink(): { worksFor: { '@id': string } } {
  return { worksFor: { '@id': COREFORGE_ORG_ID } };
}
