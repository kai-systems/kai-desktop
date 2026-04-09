import { createHash } from 'crypto';
import { BrowserWindow, Notification, dialog } from 'electron';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { pathToFileURL } from 'url';
import type {
  PluginManifest,
  PluginInstance,
  PluginModule,
  PluginUIState,
  PluginRendererScript,
  PluginRendererStyle,
  PluginBannerDescriptor,
  PluginModalDescriptor,
  PluginSettingsSectionDescriptor,
  PluginPanelDescriptor,
  PluginNavigationItemDescriptor,
  PluginCommandDescriptor,
  PluginConversationDecorationDescriptor,
  PluginThreadDecorationDescriptor,
  PluginNotificationDescriptor,
  PluginActionPayload,
  PluginNavigationTarget,
  PreSendHookArgs,
  PreSendHookResult,
  PostReceiveHookArgs,
  PostReceiveHookResult,
  PluginAPI,
  PluginPermission,
} from './types.js';
import { createPluginAPI, cleanupPluginAPI } from './plugin-api.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from '../tools/types.js';
import { broadcastToAllWindows } from '../utils/window-send.js';
import { convertJsonSchemaToZod } from '../tools/skill-loader.js';
import { readConversationStore, writeConversationStore, broadcastConversationChange } from '../ipc/conversations.js';
import { unregisterAgentBackend, unregisterAgentBackendsForPlugin } from '../agent/backend-registry.js';

const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  'config:read': 'Read app configuration',
  'config:write': 'Write app configuration',
  'tools:register': 'Register tools the assistant can call',
  'ui:banner': 'Show inline banner UI in the app',
  'ui:modal': 'Show modal UI in the app',
  'ui:settings': 'Add plugin settings screens',
  'ui:panel': 'Register full-page plugin panels',
  'ui:navigation': 'Register navigation items and conversation decorations',
  'messages:hook': 'Inspect or modify model messages',
  'network:fetch': 'Make network requests from the plugin runtime',
  'auth:window': 'Open authentication browser windows',
  'http:listen': 'Listen on a local HTTP callback port',
  'notifications:send': 'Send in-app and native notifications',
  'conversations:read': 'Read conversation data',
  'conversations:write': 'Create or update conversation data',
  'navigation:open': 'Request in-app navigation actions',
  'state:publish': 'Publish plugin state and live events to the renderer',
  'agent:backend': 'Register alternate agent backends',
};

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return;

  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function normalizePluginObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

type PluginListEntry = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  state: string;
  required: boolean;
  brandRequired: boolean;
  error?: string;
};

export class PluginManager {
  private plugins: Map<string, PluginInstance> = new Map();
  private pluginAPIs: Map<string, PluginAPI> = new Map();
  private toolChangeCallback: ((tools: ToolDefinition[]) => void) | null = null;
  private actionHandlers: Map<string, Map<string, (action: string, data?: unknown) => void | Promise<void>>> = new Map();
  private notificationTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private pluginsDir: string,
    private appHome: string,
    private getConfig: () => AppConfig,
    private setConfig: (path: string, value: unknown) => void,
    private brandRequiredPluginNames: Set<string> = new Set(),
  ) {}

  /* ── Discovery ── */

  private discoverPlugins(): Array<{ manifest: PluginManifest; dir: string }> {
    if (!existsSync(this.pluginsDir)) return [];

    const results: Array<{ manifest: PluginManifest; dir: string }> = [];
    let entries: string[];

    try {
      entries = readdirSync(this.pluginsDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      const pluginDir = join(this.pluginsDir, entry);
      try {
        if (!statSync(pluginDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const manifestPath = join(pluginDir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        const manifest: PluginManifest = {
          name: typeof raw.name === 'string' ? raw.name : entry,
          displayName: typeof raw.displayName === 'string' ? raw.displayName : typeof raw.name === 'string' ? raw.name : entry,
          version: typeof raw.version === 'string' ? raw.version : '0.0.0',
          description: typeof raw.description === 'string' ? raw.description : '',
          main: typeof raw.main === 'string' ? raw.main : 'main.js',
          renderer: typeof raw.renderer === 'string' ? raw.renderer : undefined,
          rendererStyles: Array.isArray(raw.rendererStyles)
            ? raw.rendererStyles.filter((value): value is string => typeof value === 'string')
            : undefined,
          permissions: Array.isArray(raw.permissions)
            ? raw.permissions.filter((value): value is PluginPermission => typeof value === 'string')
            : [],
          priority: typeof raw.priority === 'number' ? raw.priority : 100,
          required: raw.required === true || this.brandRequiredPluginNames.has(typeof raw.name === 'string' ? raw.name : entry),
          configSchema: raw.configSchema && typeof raw.configSchema === 'object'
            ? raw.configSchema as Record<string, unknown>
            : undefined,
        };
        results.push({ manifest, dir: pluginDir });
      } catch (err) {
        console.warn(`[PluginManager] Failed to read plugin manifest at ${manifestPath}:`, err);
      }
    }

    results.sort((a, b) => a.manifest.priority - b.manifest.priority);
    return results;
  }

  /* ── Loading ── */

  private collectPluginFiles(rootDir: string, currentDir = rootDir): string[] {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.collectPluginFiles(rootDir, fullPath));
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private computePluginFileHash(dir: string): string {
    const hash = createHash('sha256');
    const files = this.collectPluginFiles(dir);

    for (const filePath of files) {
      const relativePath = relative(dir, filePath).replace(/\\/g, '/');
      hash.update(relativePath);
      hash.update('\0');
      hash.update(readFileSync(filePath));
      hash.update('\0');
    }

    return hash.digest('hex');
  }

  private getPluginApprovals(): AppConfig['pluginApprovals'] {
    return this.getConfig().pluginApprovals ?? {};
  }

  private isPluginApproved(pluginName: string, fileHash: string): boolean {
    return this.getPluginApprovals()[pluginName]?.hash === fileHash;
  }

  private persistPluginApproval(pluginName: string, fileHash: string): void {
    this.setConfig('pluginApprovals', {
      ...this.getPluginApprovals(),
      [pluginName]: {
        hash: fileHash,
        approvedAt: new Date().toISOString(),
      },
    });
  }

  private async ensurePluginApproved(manifest: PluginManifest, fileHash: string): Promise<boolean> {
    if (this.isPluginApproved(manifest.name, fileHash)) {
      return true;
    }

    if (this.brandRequiredPluginNames.has(manifest.name)) {
      this.persistPluginApproval(manifest.name, fileHash);
      return true;
    }

    const declaredPermissions = manifest.permissions.length > 0
      ? manifest.permissions.map((permission) => `• ${PLUGIN_PERMISSION_LABELS[permission] ?? permission}`).join('\n')
      : '• This plugin did not declare any permissions in plugin.json.';
    const detail = [
      `Plugin: ${manifest.displayName} (${manifest.name})`,
      `Version: ${manifest.version}`,
      '',
      manifest.description || 'No description provided.',
      '',
      'Declared permissions:',
      declaredPermissions,
      '',
      `Approval fingerprint: ${fileHash.slice(0, 16)}`,
      'This approval is tied to the current plugin files. If the plugin changes, ' + __BRAND_PRODUCT_NAME + ' will ask again before loading it.',
    ].join('\n');

    const messageBoxOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Allow Plugin', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `Allow "${manifest.displayName}" to load?`,
      detail,
    };
    const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);

    if (result.response !== 0) {
      return false;
    }

    this.persistPluginApproval(manifest.name, fileHash);
    return true;
  }

  private validatePluginConfig(manifest: PluginManifest, input: unknown): Record<string, unknown> {
    const normalized = normalizePluginObject(input);
    if (!manifest.configSchema) {
      return normalized;
    }

    try {
      const validator = convertJsonSchemaToZod(manifest.configSchema);
      const parsed = validator.safeParse(normalized);
      if (parsed.success) {
        return normalizePluginObject(parsed.data);
      }

      const defaults = validator.safeParse({});
      if (defaults.success) {
        console.warn(`[PluginManager] Resetting invalid config for plugin "${manifest.name}" to schema defaults`);
        return normalizePluginObject(defaults.data);
      }

      console.warn(`[PluginManager] Plugin "${manifest.name}" config schema validation failed; preserving raw config`);
      return normalized;
    } catch (err) {
      console.warn(`[PluginManager] Failed to validate config for plugin "${manifest.name}":`, err);
      return normalized;
    }
  }

  private ensurePluginConfigNormalized(pluginName: string): Record<string, unknown> {
    const instance = this.plugins.get(pluginName);
    if (!instance) return {};

    const config = this.getConfig();
    const plugins = (config as Record<string, unknown>).plugins as Record<string, unknown> | undefined;
    const raw = plugins?.[pluginName];
    const validated = this.validatePluginConfig(instance.manifest, raw);
    const current = normalizePluginObject(raw);
    if (JSON.stringify(current) !== JSON.stringify(validated)) {
      this.setConfig(`plugins.${pluginName}`, validated);
    }
    return validated;
  }

  async loadAll(): Promise<void> {
    const discovered = this.discoverPlugins();
    console.info(`[PluginManager] Discovered ${discovered.length} plugins`);

    for (const { manifest, dir } of discovered) {
      await this.loadPlugin(manifest, dir);
    }
  }

  private async loadPlugin(manifest: PluginManifest, dir: string): Promise<void> {
    const instance: PluginInstance = {
      manifest,
      dir,
      fileHash: '',
      state: 'loading',
      module: null,
      registeredTools: [],
      registeredBackendKeys: [],
      preSendHooks: [],
      postReceiveHooks: [],
      uiBanners: [],
      uiModals: [],
      uiSettingsSections: [],
      uiPanels: [],
      uiNavigationItems: [],
      uiCommands: [],
      conversationDecorations: [],
      threadDecorations: [],
      publishedState: {},
      notifications: [],
      configChangeListeners: [],
    };

    this.plugins.set(manifest.name, instance);

    try {
      instance.fileHash = this.computePluginFileHash(dir);
      if (!(await this.ensurePluginApproved(manifest, instance.fileHash))) {
        instance.state = 'disabled';
        instance.error = 'Plugin permission approval is required before it can be loaded.';
        this.broadcastUIState();
        this.notifyToolsChanged();
        return;
      }

      this.ensurePluginConfigNormalized(manifest.name);

      const mainPath = join(dir, manifest.main);
      if (!existsSync(mainPath)) {
        throw new Error(`Plugin entry point not found: ${mainPath}`);
      }

      const moduleUrl = pathToFileURL(mainPath).href;
      const mod = await import(moduleUrl) as PluginModule;
      instance.module = mod;

      const api = createPluginAPI(instance, {
        appHome: this.appHome,
        getConfig: () => this.getConfig(),
        setConfig: (path, value) => this.setConfig(path, value),
        getPluginConfig: () => this.getPluginConfig(manifest.name),
        setPluginConfig: (path, value) => this.setPluginConfig(manifest.name, path, value),
        getPluginState: () => ({ ...instance.publishedState }),
        replacePluginState: (next) => {
          instance.publishedState = normalizePluginObject(next);
          this.broadcastUIState();
        },
        setPluginState: (path, value) => {
          const next = { ...instance.publishedState };
          setNestedValue(next, path, value);
          instance.publishedState = next;
          this.broadcastUIState();
        },
        emitPluginEvent: (eventName, data) => {
          broadcastToAllWindows('plugin:event', { pluginName: manifest.name, eventName, data });
        },
        onUIStateChanged: () => this.broadcastUIState(),
        onToolsChanged: () => this.notifyToolsChanged(),
        registerActionHandler: (targetId, handler) => {
          this.registerActionHandler(manifest.name, targetId, handler);
        },
        showNotification: (descriptor) => this.showPluginNotification(manifest.name, descriptor),
        dismissNotification: (id) => this.dismissPluginNotification(manifest.name, id),
        openNavigationTarget: (target) => this.broadcastNavigationRequest(manifest.name, target),
      });
      this.pluginAPIs.set(manifest.name, api);

      if (typeof mod.activate === 'function') {
        await mod.activate(api);
      }

      instance.state = 'active';
      instance.error = undefined;
      this.broadcastUIState();
      this.notifyToolsChanged();
      console.info(`[PluginManager] Plugin "${manifest.name}" activated (priority=${manifest.priority}, required=${manifest.required})`);
    } catch (err) {
      instance.state = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      this.broadcastUIState();
      this.notifyToolsChanged();
      console.error(`[PluginManager] Failed to load plugin "${manifest.name}":`, err);
    }
  }

  /* ── Unloading ── */

  async unloadAll(): Promise<void> {
    const sorted = [...this.plugins.entries()].sort(([, a], [, b]) => b.manifest.priority - a.manifest.priority);

    for (const [name, instance] of sorted) {
      try {
        if (instance.module?.deactivate) {
          await instance.module.deactivate();
        }
        const api = this.pluginAPIs.get(name);
        if (api) {
          await cleanupPluginAPI(api);
        }
      } catch (err) {
        console.error(`[PluginManager] Error deactivating plugin "${name}":`, err);
      }

      unregisterAgentBackendsForPlugin(name);
    }

    for (const timer of this.notificationTimers.values()) {
      clearTimeout(timer);
    }

    this.plugins.clear();
    this.pluginAPIs.clear();
    this.actionHandlers.clear();
    this.notificationTimers.clear();
    this.notifyToolsChanged();
  }

  /* ── Permissions / Queries ── */

  hasPermission(pluginName: string, permission: PluginPermission): boolean {
    return this.plugins.get(pluginName)?.manifest.permissions.includes(permission) ?? false;
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  listPlugins(): PluginListEntry[] {
    return [...this.plugins.values()].map((instance) => ({
      name: instance.manifest.name,
      displayName: instance.manifest.displayName,
      version: instance.manifest.version,
      description: instance.manifest.description,
      state: instance.state,
      required: instance.manifest.required,
      brandRequired: this.brandRequiredPluginNames.has(instance.manifest.name),
      error: instance.error,
    }));
  }

  getPluginConfig(pluginName: string): Record<string, unknown> {
    const instance = this.plugins.get(pluginName);
    if (!instance) return {};
    return this.validatePluginConfig(instance.manifest, this.getConfig().plugins?.[pluginName]);
  }

  setPluginConfig(pluginName: string, path: string, value: unknown): void {
    const instance = this.plugins.get(pluginName);
    if (!instance) {
      throw new Error(`Unknown plugin "${pluginName}"`);
    }

    const next = this.getPluginConfig(pluginName);
    setNestedValue(next, path, value);
    const validated = this.validatePluginConfig(instance.manifest, next);
    this.setConfig(`plugins.${pluginName}`, validated);
  }

  /* ── Config Change Forwarding ── */

  onConfigChanged(config: AppConfig): void {
    for (const [name, instance] of this.plugins) {
      if (instance.state !== 'active') continue;

      try {
        instance.module?.onConfigChanged?.(config);
      } catch (err) {
        console.error(`[PluginManager] Error in plugin "${name}" onConfigChanged:`, err);
      }

      for (const listener of instance.configChangeListeners) {
        try {
          listener(config);
        } catch (err) {
          console.error(`[PluginManager] Error in plugin "${name}" config listener:`, err);
        }
      }
    }

    this.broadcastUIState();
  }

  /* ── Tool Aggregation ── */

  getAllPluginTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const instance of this.plugins.values()) {
      if (instance.state !== 'active') continue;
      tools.push(...instance.registeredTools);
    }
    return tools;
  }

  onToolsChanged(callback: (tools: ToolDefinition[]) => void): void {
    this.toolChangeCallback = callback;
    callback(this.getAllPluginTools());
  }

  private notifyToolsChanged(): void {
    this.toolChangeCallback?.(this.getAllPluginTools());
  }

  /* ── Message Hooks ── */

  async runPreSendHooks(args: PreSendHookArgs): Promise<PreSendHookResult> {
    let result: PreSendHookResult = { messages: args.messages };

    for (const instance of this.plugins.values()) {
      if (instance.state !== 'active') continue;
      for (const hook of instance.preSendHooks) {
        try {
          result = await hook({ ...args, messages: result.messages });
          if (result.abort) return result;
        } catch (err) {
          console.error(`[PluginManager] Pre-send hook error in "${instance.manifest.name}":`, err);
        }
      }
    }

    return result;
  }

  async runPostReceiveHooks(args: PostReceiveHookArgs): Promise<PostReceiveHookResult> {
    let result: PostReceiveHookResult = { response: args.response };

    for (const instance of this.plugins.values()) {
      if (instance.state !== 'active') continue;
      for (const hook of instance.postReceiveHooks) {
        try {
          result = await hook({ ...args, response: result.response });
        } catch (err) {
          console.error(`[PluginManager] Post-receive hook error in "${instance.manifest.name}":`, err);
        }
      }
    }

    return result;
  }

  /* ── UI State ── */

  getUIState(): PluginUIState {
    const banners: PluginBannerDescriptor[] = [];
    const modals: PluginModalDescriptor[] = [];
    const settingsSections: PluginSettingsSectionDescriptor[] = [];
    const panels: PluginPanelDescriptor[] = [];
    const navigationItems: PluginNavigationItemDescriptor[] = [];
    const commands: PluginCommandDescriptor[] = [];
    const conversationDecorations: PluginConversationDecorationDescriptor[] = [];
    const threadDecorations: PluginThreadDecorationDescriptor[] = [];
    const rendererScripts: PluginRendererScript[] = [];
    const rendererStyles: PluginRendererStyle[] = [];
    const pluginConfigs: Record<string, Record<string, unknown>> = {};
    const pluginStates: Record<string, Record<string, unknown>> = {};
    const notifications: PluginNotificationDescriptor[] = [];
    let requiredPluginsReady = true;

    for (const instance of this.plugins.values()) {
      pluginConfigs[instance.manifest.name] = this.getPluginConfig(instance.manifest.name);
      pluginStates[instance.manifest.name] = { ...instance.publishedState };

      if ((instance.state === 'error' || instance.state === 'disabled') && instance.manifest.required) {
        requiredPluginsReady = false;
      }

      banners.push(...instance.uiBanners);
      modals.push(...instance.uiModals);
      settingsSections.push(...instance.uiSettingsSections);
      panels.push(...instance.uiPanels);
      navigationItems.push(...instance.uiNavigationItems);
      commands.push(...instance.uiCommands);
      conversationDecorations.push(...instance.conversationDecorations);
      threadDecorations.push(...instance.threadDecorations);
      notifications.push(...instance.notifications.filter((notification) => notification.visible));

      if (instance.state !== 'disabled' && instance.state !== 'error' && instance.manifest.renderer) {
        const scriptPath = join(instance.dir, instance.manifest.renderer);
        if (existsSync(scriptPath)) {
          try {
            const scriptContent = readFileSync(scriptPath, 'utf-8');
            rendererScripts.push({
              pluginName: instance.manifest.name,
              scriptPath,
              scriptHash: hashContent(scriptContent),
              scriptContent,
            });
          } catch (err) {
            console.warn(`[PluginManager] Failed to read renderer for "${instance.manifest.name}":`, err);
          }
        }
      }

      for (const styleRelPath of instance.manifest.rendererStyles ?? []) {
        const stylePath = join(instance.dir, styleRelPath);
        if (!existsSync(stylePath)) continue;
        try {
          const styleContent = readFileSync(stylePath, 'utf-8');
          rendererStyles.push({
            pluginName: instance.manifest.name,
            stylePath,
            styleHash: hashContent(styleContent),
            styleContent,
          });
        } catch (err) {
          console.warn(`[PluginManager] Failed to read renderer style for "${instance.manifest.name}":`, err);
        }
      }

      if (instance.manifest.required) {
        const hasBlockingModal = instance.uiModals.some((modal) => modal.visible && !modal.closeable);
        if (hasBlockingModal) {
          requiredPluginsReady = false;
        }
      }
    }

    settingsSections.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    panels.sort((a, b) => a.title.localeCompare(b.title));
    navigationItems.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    commands.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    for (const requiredName of this.brandRequiredPluginNames) {
      if (!this.plugins.has(requiredName)) {
        requiredPluginsReady = false;
        break;
      }
    }

    return {
      banners,
      modals,
      settingsSections,
      panels,
      navigationItems,
      commands,
      conversationDecorations,
      threadDecorations,
      rendererScripts,
      rendererStyles,
      pluginConfigs,
      pluginStates,
      notifications,
      requiredPluginsReady,
      brandRequiredPluginNames: [...this.brandRequiredPluginNames],
    };
  }

  private broadcastUIState(): void {
    broadcastToAllWindows('plugin:ui-state-changed', this.getUIState());
  }

  /* ── Actions (renderer → main) ── */

  registerActionHandler(
    pluginName: string,
    targetId: string,
    handler: (action: string, data?: unknown) => void | Promise<void>,
  ): void {
    let pluginHandlers = this.actionHandlers.get(pluginName);
    if (!pluginHandlers) {
      pluginHandlers = new Map();
      this.actionHandlers.set(pluginName, pluginHandlers);
    }
    pluginHandlers.set(targetId, handler);
  }

  async handleAction(payload: PluginActionPayload): Promise<unknown> {
    const handler = this.actionHandlers.get(payload.pluginName)?.get(payload.targetId);
    if (!handler) {
      console.warn(`[PluginManager] No action handler for ${payload.pluginName}:${payload.targetId}`);
      return { error: 'No handler registered' };
    }
    return handler(payload.action, payload.data);
  }

  sendModalCallback(pluginName: string, modalId: string, data: unknown): void {
    broadcastToAllWindows('plugin:modal-callback', { pluginName, modalId, data });
  }

  /* ── Notifications / Navigation ── */

  private notificationTimerKey(pluginName: string, id: string): string {
    return `${pluginName}:${id}`;
  }

  private clearNotificationTimer(pluginName: string, id: string): void {
    const key = this.notificationTimerKey(pluginName, id);
    const timer = this.notificationTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.notificationTimers.delete(key);
    }
  }

  private broadcastNavigationRequest(pluginName: string, target: PluginNavigationTarget): void {
    broadcastToAllWindows('plugin:navigation-request', { pluginName, target });
  }

  showPluginNotification(
    pluginName: string,
    descriptor: Omit<PluginNotificationDescriptor, 'pluginName' | 'visible'>,
  ): void {
    const instance = this.plugins.get(pluginName);
    if (!instance) return;

    const full: PluginNotificationDescriptor = {
      ...descriptor,
      pluginName,
      visible: true,
    };
    const existingIndex = instance.notifications.findIndex((notification) => notification.id === descriptor.id);
    if (existingIndex >= 0) {
      instance.notifications[existingIndex] = full;
    } else {
      instance.notifications.push(full);
    }

    this.clearNotificationTimer(pluginName, descriptor.id);
    if (typeof descriptor.autoDismissMs === 'number' && descriptor.autoDismissMs > 0) {
      const key = this.notificationTimerKey(pluginName, descriptor.id);
      const timer = setTimeout(() => {
        this.dismissPluginNotification(pluginName, descriptor.id);
      }, descriptor.autoDismissMs);
      this.notificationTimers.set(key, timer);
    }

    if (descriptor.native && Notification.isSupported()) {
      const nativeNotification = new Notification({
        title: descriptor.title,
        body: descriptor.body ?? '',
      });
      if (descriptor.target) {
        nativeNotification.on('click', () => {
          this.broadcastNavigationRequest(pluginName, descriptor.target!);
        });
      }
      nativeNotification.show();
    }

    this.broadcastUIState();
  }

  dismissPluginNotification(pluginName: string, id: string): void {
    const instance = this.plugins.get(pluginName);
    if (!instance) return;

    const existingIndex = instance.notifications.findIndex((notification) => notification.id === id);
    if (existingIndex < 0) return;

    instance.notifications[existingIndex] = {
      ...instance.notifications[existingIndex],
      visible: false,
    };
    this.clearNotificationTimer(pluginName, id);
    this.broadcastUIState();
  }

  /* ── Agent Backends ── */

  unregisterPluginBackend(pluginName: string, key: string): void {
    const instance = this.plugins.get(pluginName);
    if (!instance) return;
    instance.registeredBackendKeys = instance.registeredBackendKeys.filter((backendKey) => backendKey !== key);
    unregisterAgentBackend(key);
  }

  /* ── Conversation Helpers ── */

  listConversations(): Array<Record<string, unknown>> {
    const store = readConversationStore(this.appHome);
    return Object.values(store.conversations);
  }

  getConversation(conversationId: string): Record<string, unknown> | null {
    return readConversationStore(this.appHome).conversations[conversationId] ?? null;
  }

  upsertConversation(conversation: Record<string, unknown>): void {
    const store = readConversationStore(this.appHome);
    const conversationId = typeof conversation.id === 'string' ? conversation.id : '';
    if (!conversationId) {
      throw new Error('Conversation id is required');
    }

    store.conversations[conversationId] = conversation as typeof store.conversations[string];
    writeConversationStore(this.appHome, store);
    broadcastConversationChange(store);
  }

  setActiveConversation(conversationId: string): void {
    const store = readConversationStore(this.appHome);
    store.activeConversationId = conversationId;
    writeConversationStore(this.appHome, store);
    broadcastConversationChange(store);
  }

  appendConversationMessage(
    conversationId: string,
    message: {
      role: string;
      content: unknown;
      metadata?: Record<string, unknown>;
      parentId?: string | null;
      createdAt?: string;
    },
  ): Record<string, unknown> | null {
    const store = readConversationStore(this.appHome);
    const conversation = store.conversations[conversationId];
    if (!conversation) return null;

    const messageId = `plugin-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = message.createdAt ?? new Date().toISOString();
    const normalizedRole = message.role === 'user' ? 'user' : 'assistant';
    const normalizedContent = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : Array.isArray(message.content)
        ? message.content
        : [];
    const parentId = message.parentId
      ?? (Array.isArray(conversation.messages) && conversation.messages.length > 0
        ? ((conversation.messages[conversation.messages.length - 1] as { id?: string }).id ?? null)
        : null);

    const nextMessage: Record<string, unknown> = {
      id: messageId,
      role: normalizedRole,
      content: normalizedContent,
      parentId,
      createdAt,
      metadata: {
        ...(message.metadata ?? {}),
        originalRole: message.role,
      },
    };

    const nextMessages = Array.isArray(conversation.messages) ? [...conversation.messages, nextMessage] : [nextMessage];
    const nextConversation = {
      ...conversation,
      messages: nextMessages,
      updatedAt: createdAt,
      lastMessageAt: createdAt,
      lastAssistantUpdateAt: normalizedRole === 'assistant' ? createdAt : conversation.lastAssistantUpdateAt,
      messageCount: nextMessages.length,
      userMessageCount: normalizedRole === 'user'
        ? (conversation.userMessageCount ?? 0) + 1
        : conversation.userMessageCount ?? 0,
      hasUnread: normalizedRole === 'assistant' ? true : conversation.hasUnread,
    };

    store.conversations[conversationId] = nextConversation;
    writeConversationStore(this.appHome, store);
    broadcastConversationChange(store);
    return nextConversation;
  }

  markConversationUnread(conversationId: string, unread: boolean): void {
    const store = readConversationStore(this.appHome);
    const conversation = store.conversations[conversationId];
    if (!conversation) return;
    store.conversations[conversationId] = {
      ...conversation,
      hasUnread: unread,
      updatedAt: new Date().toISOString(),
    };
    writeConversationStore(this.appHome, store);
    broadcastConversationChange(store);
  }
}
