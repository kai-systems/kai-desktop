import type { FC } from 'react';
import { XIcon } from 'lucide-react';
import { useConfig } from '@/providers/ConfigProvider';
import { usePlugins, type PluginPanelDescriptor } from '@/providers/PluginProvider';
import { getPluginComponent } from './PluginComponentRegistry';

const widthClassMap: Record<NonNullable<PluginPanelDescriptor['width']>, string> = {
  default: 'max-w-5xl',
  wide: 'max-w-6xl',
  full: 'max-w-none',
};

export const PluginPanelHost: FC<{
  panel: PluginPanelDescriptor;
  onClose: () => void;
}> = ({ panel, onClose }) => {
  const { config, updateConfig } = useConfig();
  const {
    sendAction,
    setPluginConfig,
    getResolvedPluginConfig,
    getPluginState,
    rendererLoadCount,
    getPluginStatus,
    getPluginError,
    hasRendererScript,
    getPluginRendererStatus,
    getPluginRendererError,
  } = usePlugins();

  void rendererLoadCount;

  const Component = getPluginComponent(panel.pluginName, panel.component);
  const pluginStatus = getPluginStatus(panel.pluginName);
  const pluginError = getPluginError(panel.pluginName);
  const rendererStatus = getPluginRendererStatus(panel.pluginName);
  const rendererError = getPluginRendererError(panel.pluginName);
  const waitingForRenderer = !Component && (
    pluginStatus === 'loading'
    || (hasRendererScript(panel.pluginName) && rendererStatus !== 'error')
  );
  const widthClass = widthClassMap[panel.width ?? 'default'];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{panel.title}</h1>
          <p className="text-xs text-muted-foreground">{panel.pluginName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50"
          title="Close"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className={`mx-auto w-full ${widthClass}`}>
          {Component ? (
            <Component
              pluginName={panel.pluginName}
              props={panel.props}
              config={config ?? undefined}
              updateConfig={updateConfig}
              pluginConfig={getResolvedPluginConfig(panel.pluginName)}
              pluginState={getPluginState(panel.pluginName)}
              onAction={(action, data) => {
                sendAction(panel.pluginName, `panel:${panel.id}`, action, data);
              }}
              onClose={onClose}
              setPluginConfig={async (path, value) => {
                await setPluginConfig(panel.pluginName, path, value);
              }}
            />
          ) : waitingForRenderer ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
              Loading plugin UI for "{panel.pluginName}"...
            </div>
          ) : pluginError || rendererError ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
              Failed to load the plugin UI for "{panel.pluginName}": {pluginError || rendererError}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
              Plugin component "{panel.component}" is not registered for "{panel.pluginName}".
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
