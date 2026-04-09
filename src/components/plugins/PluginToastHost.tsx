import type { FC } from 'react';
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { usePlugins } from '@/providers/PluginProvider';

const levelClasses = {
  info: 'border-blue-500/20 bg-blue-500/10 text-blue-800 dark:text-blue-300',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  error: 'border-red-500/20 bg-red-500/10 text-red-800 dark:text-red-300',
} as const;

const levelIcons = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  error: AlertCircleIcon,
} as const;

export const PluginToastHost: FC = () => {
  const { uiState } = usePlugins();

  const notifications = uiState?.notifications?.filter((notification) => notification.visible) ?? [];
  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-3">
      {notifications.slice(-4).reverse().map((notification) => {
        const level = notification.level ?? 'info';
        const Icon = levelIcons[level];
        return (
          <div
            key={`${notification.pluginName}-${notification.id}`}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${levelClasses[level]}`}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{notification.title}</div>
                {notification.body && (
                  <p className="mt-1 text-xs opacity-90">{notification.body}</p>
                )}
                <p className="mt-1 text-[11px] opacity-70">{notification.pluginName}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
