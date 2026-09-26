/*
 * lucide-react components for the icon names in ./facts.ts. Kept out of facts.ts so the
 * facts stay importable by node --test. The *Icon exports avoid shadowing globals such
 * as History.
 */
import {
  BookOpenIcon,
  CirclePlayIcon,
  CompassIcon,
  DumbbellIcon,
  GraduationCapIcon,
  HistoryIcon,
  LanguagesIcon,
  LayersIcon,
  LibraryIcon,
  LightbulbIcon,
  NewspaperIcon,
  RssIcon,
  ScrollTextIcon,
  SearchCheckIcon,
  ShuffleIcon,
  TimerIcon,
  WifiOffIcon,
  type LucideIcon,
} from 'lucide-react';
import type { CoreforgeIconName } from './facts.ts';

export const COREFORGE_ICONS = {
  CirclePlay: CirclePlayIcon,
  Shuffle: ShuffleIcon,
  Timer: TimerIcon,
  Layers: LayersIcon,
  Dumbbell: DumbbellIcon,
  SearchCheck: SearchCheckIcon,
  Compass: CompassIcon,
  Lightbulb: LightbulbIcon,
  WifiOff: WifiOffIcon,
  BookOpen: BookOpenIcon,
  Newspaper: NewspaperIcon,
  Rss: RssIcon,
  Library: LibraryIcon,
  Languages: LanguagesIcon,
  ScrollText: ScrollTextIcon,
  GraduationCap: GraduationCapIcon,
  History: HistoryIcon,
} as const satisfies Record<CoreforgeIconName, LucideIcon>;
