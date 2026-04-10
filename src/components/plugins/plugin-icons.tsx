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

/* Outline-only Teams icon matching Lucide style (24×24, stroke, no fill) */
function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Front person head */}
      <circle cx="10" cy="5.5" r="2.5" />
      {/* Front person body — rounded rectangle */}
      <path d="M5 12a5 5 0 0 1 10 0v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      {/* Back person head */}
      <circle cx="17" cy="6.5" r="2" />
      {/* Back person body — partial, behind front person */}
      <path d="M15 13a4 4 0 0 1 6 0v3.5a1.5 1.5 0 0 1-1.5 1.5H17" />
      {/* T badge — filled block with knocked-out T */}
      <rect x="2.5" y="14" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
      <path d="M4.25 16h4.5M6.5 16v3.5" stroke="var(--color-background, #0a0a0f)" strokeWidth="1.5" />
    </svg>
  );
}

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
  teams: <TeamsIcon className="h-[18px] w-[18px]" />,
  terminal: <TerminalSquareIcon className="h-[18px] w-[18px]" />,
};

export function getPluginNavigationIcon(iconName?: string): ReactNode {
  if (!iconName) return iconMap.puzzle;
  return iconMap[iconName] ?? iconMap.puzzle;
}
