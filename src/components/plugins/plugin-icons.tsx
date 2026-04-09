import type { ReactNode } from 'react';
import {
  ActivityIcon,
  BellIcon,
  BookOpenIcon,
  BotIcon,
  BoxesIcon,
  BrainCircuitIcon,
  CpuIcon,
  DatabaseIcon,
  GaugeIcon,
  GitBranchIcon,
  GlobeIcon,
  LayoutPanelTopIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  TerminalSquareIcon,
} from 'lucide-react';

const iconMap: Record<string, ReactNode> = {
  activity: <ActivityIcon className="h-[18px] w-[18px]" />,
  bell: <BellIcon className="h-[18px] w-[18px]" />,
  book: <BookOpenIcon className="h-[18px] w-[18px]" />,
  bot: <BotIcon className="h-[18px] w-[18px]" />,
  boxes: <BoxesIcon className="h-[18px] w-[18px]" />,
  brain: <BrainCircuitIcon className="h-[18px] w-[18px]" />,
  cpu: <CpuIcon className="h-[18px] w-[18px]" />,
  database: <DatabaseIcon className="h-[18px] w-[18px]" />,
  gauge: <GaugeIcon className="h-[18px] w-[18px]" />,
  git: <GitBranchIcon className="h-[18px] w-[18px]" />,
  globe: <GlobeIcon className="h-[18px] w-[18px]" />,
  panel: <LayoutPanelTopIcon className="h-[18px] w-[18px]" />,
  puzzle: <PuzzleIcon className="h-[18px] w-[18px]" />,
  search: <SearchIcon className="h-[18px] w-[18px]" />,
  settings: <SettingsIcon className="h-[18px] w-[18px]" />,
  terminal: <TerminalSquareIcon className="h-[18px] w-[18px]" />,
};

export function getPluginNavigationIcon(iconName?: string): ReactNode {
  if (!iconName) return iconMap.puzzle;
  return iconMap[iconName] ?? iconMap.puzzle;
}
