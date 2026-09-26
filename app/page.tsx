import projectsStore from '@/data/ai-generated/projects.json';
import recruiterStore from '@/data/ai-generated/recruiter.json';
import { PROJECTS } from '@/data/projects';
import { fetchCoreforgeNews } from '@/lib/coreforge/news';
import { getKaggleData } from '@/lib/kaggle/client.server';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import { visibleLenses, type LensStore } from '@/lib/ai/fit';
import { selectInterests } from '@/lib/ai/prompts/projects';
import App from '../src/App';

// Worked out here, on the server, so the About card's lens chips and the grid's
// interest chips are in the first paint without their stores (or the review flags)
// shipping with the page.
const LENS_CHIPS = visibleLenses(recruiterStore as unknown as LensStore, SHOW_UNREVIEWED).map(({ def }) => ({
  id: def.id,
  label: def.label,
}));
const INTERESTS = selectInterests(
  projectsStore,
  PROJECTS.map((p) => p.slug),
  SHOW_UNREVIEWED,
);

// Prerendered, then regenerated at most hourly: the CoreForge news slot and the
// Kaggle section are read here, on the server, so both are in the static HTML. The
// Kaggle read keeps its own six-hour cache and falls back to the committed
// snapshot; the news read falls back to an empty list. Neither can fail the page.
export const revalidate = 3600;

export default async function Page() {
  const [kaggle, coreforgeNews] = await Promise.all([
    getKaggleData(),
    fetchCoreforgeNews({ limit: 3, revalidate: 3600 }),
  ]);
  return <App lensChips={LENS_CHIPS} interests={INTERESTS} kaggle={kaggle} coreforgeNews={coreforgeNews} />;
}
