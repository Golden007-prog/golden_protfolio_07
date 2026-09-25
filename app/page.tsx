import projectsStore from '@/data/ai-generated/projects.json';
import recruiterStore from '@/data/ai-generated/recruiter.json';
import { PROJECTS } from '@/data/projects';
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

export default function Page() {
  return <App lensChips={LENS_CHIPS} interests={INTERESTS} />;
}
