import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { XIcon, ChevronRightIcon } from 'lucide-react';
import { useConfig } from '@/providers/ConfigProvider';
import { EditableTextarea } from '@/components/EditableTextarea';
import { EditableInput } from '@/components/EditableInput';
import { ModelSettings } from './ModelSettings';
import { ProfileSettings } from './ProfileSettings';
import { CompactionSettings } from './CompactionSettings';
import { MemorySettings } from './MemorySettings';
import { ToolSettings } from './ToolSettings';
import { CliToolsSettings } from './CliToolsSettings';
import { AdvancedSettings } from './AdvancedSettings';
import { McpSettings } from './McpSettings';
import { SkillSettings } from './SkillSettings';
import { AudioSettings } from './AudioSettings';
import { RealtimeSettings } from './RealtimeSettings';
import { ComputerUseSettings } from './ComputerUseSettings';
import { MediaGenerationSettings } from './MediaGenerationSettings';
import { UsageDashboard } from './UsageDashboard';
import type { SettingsProps } from './shared';
import { usePluginSettingsSections } from '@/components/plugins/PluginSettingsSections';
import { getPluginComponent } from '@/components/plugins/PluginComponentRegistry';
import { usePlugins } from '@/providers/PluginProvider';

type SettingsSection =
  | 'models'
  | 'profiles'
  | 'memory'
  | 'compaction'
  | 'tools'
  | 'cli-tools'
  | 'skills'
  | 'sub-agents'
  | 'system-prompt'
  | 'mcp'
  | 'audio'
  | 'realtime'
  | 'media-generation'
  | 'computer-use'
  | 'advanced'
  | 'usage';

const sections: Array<{ key: SettingsSection; label: string }> = [
  { key: 'models', label: 'Models' },
  { key: 'profiles', label: 'Profiles' },
  { key: 'memory', label: 'Memory' },
  { key: 'compaction', label: 'Compaction' },
  { key: 'tools', label: 'Tools' },
  { key: 'cli-tools', label: 'CLI Tools' },
  { key: 'skills', label: 'Skills' },
  { key: 'sub-agents', label: 'Sub-Agents' },
  { key: 'system-prompt', label: 'System Prompt' },
  { key: 'mcp', label: 'MCP Servers' },
  { key: 'audio', label: 'Audio' },
  { key: 'realtime', label: 'Realtime Audio' },
  { key: 'media-generation', label: 'Media Generation' },
  { key: 'computer-use', label: 'Computer Use' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'usage', label: 'Usage' },
];

export const SettingsPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState<string>('models');
  const { config, updateConfig } = useConfig();
  const pluginSections = usePluginSettingsSections();
  const { setPluginConfig, sendAction, getResolvedPluginConfig, getPluginState } = usePlugins();
  const sortedPluginSections = [...pluginSections].sort((a, b) => a.priority - b.priority);
  const hasPluginSections = sortedPluginSections.length > 0;

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('close-settings', handler);
    return () => window.removeEventListener('close-settings', handler);
  }, [onClose]);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      <div className="app-shell-panel w-[220px] space-y-1 overflow-y-auto border-r border-border/70 bg-sidebar/55 p-3">
        <div className="mb-3 flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em]">Settings</span>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 transition-colors hover:bg-muted">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => setActiveSection(section.key)}
            className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium transition-all ${
              activeSection === section.key
                ? 'bg-primary text-primary-foreground shadow-[0_12px_28px_var(--brand-accent-glow)]'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
          >
            {section.label}
            <ChevronRightIcon className="ml-auto h-3 w-3 opacity-50" />
          </button>
        ))}

        {hasPluginSections && (
          <>
            <div className="flex items-center gap-2 px-1 pb-1 pt-3">
              <div className="h-px flex-1 bg-border" />
              <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Plugin Settings
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {sortedPluginSections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium transition-all ${
                  activeSection === section.key
                    ? 'bg-primary text-primary-foreground shadow-[0_12px_28px_var(--brand-accent-glow)]'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
              >
                {section.label}
                <ChevronRightIcon className="ml-auto h-3 w-3 opacity-50" />
              </button>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {activeSection === 'models' && <ModelSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'profiles' && <ProfileSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'memory' && <MemorySettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'compaction' && <CompactionSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'tools' && <ToolSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'cli-tools' && <CliToolsSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'skills' && <SkillSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'sub-agents' && <SubAgentSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'system-prompt' && <SystemPromptSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'mcp' && <McpSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'audio' && <AudioSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'realtime' && <RealtimeSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'media-generation' && <MediaGenerationSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'computer-use' && <ComputerUseSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'advanced' && <AdvancedSettings config={config} updateConfig={updateConfig} />}
        {activeSection === 'usage' && <UsageDashboard config={config} updateConfig={updateConfig} />}

        {pluginSections.map((pluginSection) => {
          if (activeSection !== pluginSection.key) return null;
          const Component = getPluginComponent(pluginSection.pluginName, pluginSection.component);
          if (!Component) return null;

          return (
            <Component
              key={pluginSection.key}
              pluginName={pluginSection.pluginName}
              config={config}
              updateConfig={updateConfig}
              pluginConfig={getResolvedPluginConfig(pluginSection.pluginName)}
              pluginState={getPluginState(pluginSection.pluginName)}
              onAction={(action: string, data?: unknown) => {
                sendAction(pluginSection.pluginName, `settings:${pluginSection.component}`, action, data);
              }}
              setPluginConfig={async (path, value) => {
                await setPluginConfig(pluginSection.pluginName, path, value);
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

const SystemPromptSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const configPrompt = (config as { systemPrompt?: string }).systemPrompt ?? '';
  const [draft, setDraft] = useState(configPrompt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) setDraft(configPrompt);
  }, [configPrompt]);

  const flushToConfig = useCallback((value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    updateConfig('systemPrompt', value);
  }, [updateConfig]);

  const handleChange = (value: string) => {
    setDraft(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushToConfig(value), 800);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">System Prompt</h3>
      <EditableTextarea
        className="h-[300px] w-full overflow-y-auto rounded-lg border bg-card p-3 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
        value={draft}
        onFocus={() => { isFocusedRef.current = true; }}
        onBlur={() => { isFocusedRef.current = false; }}
        onChange={(value) => handleChange(value)}
        placeholder={`Enter the system prompt for ${__BRAND_PRODUCT_NAME}...`}
      />
    </div>
  );
};

const SubAgentSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const subAgents = (config as { tools?: { subAgents?: { enabled: boolean; maxDepth: number; maxConcurrent: number; maxPerParent: number; defaultModel?: string } } }).tools?.subAgents;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Sub-Agents</h3>
      <p className="text-xs text-muted-foreground">
        Configure limits for sub-agent spawning. Sub-agents allow the AI to delegate tasks to child agents that work autonomously.
      </p>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={subAgents?.enabled ?? true}
          onChange={(event) => updateConfig('tools.subAgents.enabled', event.target.checked)}
          className="rounded"
        />
        <span className="text-xs">Enable sub-agents</span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Max Nesting Depth</label>
          <EditableInput
            className="w-full rounded-md border bg-card px-3 py-1.5 text-xs focus:ring-1 focus:ring-ring"
            value={String(subAgents?.maxDepth ?? 3)}
            onChange={(value) => {
              const next = parseInt(value, 10);
              if (!Number.isNaN(next) && next >= 1 && next <= 10) updateConfig('tools.subAgents.maxDepth', next);
            }}
          />
          <span className="text-[10px] text-muted-foreground">1-10</span>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Max Concurrent</label>
          <EditableInput
            className="w-full rounded-md border bg-card px-3 py-1.5 text-xs focus:ring-1 focus:ring-ring"
            value={String(subAgents?.maxConcurrent ?? 5)}
            onChange={(value) => {
              const next = parseInt(value, 10);
              if (!Number.isNaN(next) && next >= 1 && next <= 20) updateConfig('tools.subAgents.maxConcurrent', next);
            }}
          />
          <span className="text-[10px] text-muted-foreground">1-20</span>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Max Per Parent</label>
          <EditableInput
            className="w-full rounded-md border bg-card px-3 py-1.5 text-xs focus:ring-1 focus:ring-ring"
            value={String(subAgents?.maxPerParent ?? 3)}
            onChange={(value) => {
              const next = parseInt(value, 10);
              if (!Number.isNaN(next) && next >= 1 && next <= 10) updateConfig('tools.subAgents.maxPerParent', next);
            }}
          />
          <span className="text-[10px] text-muted-foreground">1-10</span>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Default Model Override</label>
          <EditableInput
            className="w-full rounded-md border bg-card px-3 py-1.5 text-xs focus:ring-1 focus:ring-ring"
            placeholder="Inherit from parent"
            value={subAgents?.defaultModel ?? ''}
            onChange={(value) => updateConfig('tools.subAgents.defaultModel', value || undefined)}
          />
          <span className="text-[10px] text-muted-foreground">Leave blank to inherit</span>
        </div>
      </div>
    </div>
  );
};
