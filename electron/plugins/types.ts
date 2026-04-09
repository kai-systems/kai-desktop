import type { ToolDefinition } from '../tools/types.js';
import type { AppConfig } from '../config/schema.js';
import type { AgentBackendDefinition } from '../agent/backend-registry.js';

/* ── Manifest ── */

export type PluginPermission =
  | 'config:read'
  | 'config:write'
  | 'tools:register'
  | 'ui:banner'
  | 'ui:modal'
  | 'ui:settings'
  | 'ui:panel'
  | 'ui:navigation'
  | 'messages:hook'
  | 'network:fetch'
  | 'auth:window'
  | 'http:listen'
  | 'notifications:send'
  | 'conversations:read'
  | 'conversations:write'
  | 'navigation:open'
  | 'state:publish'
  | 'agent:backend';

export type PluginApprovalRecord = {
  hash: string;
  approvedAt: string;
};

export type PluginManifest = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  main: string;
  renderer?: string;
  rendererStyles?: string[];
  permissions: PluginPermission[];
  priority: number;
  required: boolean;
  configSchema?: Record<string, unknown>;
};

/* ── Plugin State ── */

export type PluginState = 'loading' | 'active' | 'error' | 'disabled';

export type PluginInstance = {
  manifest: PluginManifest;
  dir: string;
  fileHash: string;
  state: PluginState;
  error?: string;
  module: PluginModule | null;
  registeredTools: ToolDefinition[];
  registeredBackendKeys: string[];
  preSendHooks: PreSendHook[];
  postReceiveHooks: PostReceiveHook[];
  uiBanners: PluginBannerDescriptor[];
  uiModals: PluginModalDescriptor[];
  uiSettingsSections: PluginSettingsSectionDescriptor[];
  uiPanels: PluginPanelDescriptor[];
  uiNavigationItems: PluginNavigationItemDescriptor[];
  uiCommands: PluginCommandDescriptor[];
  conversationDecorations: PluginConversationDecorationDescriptor[];
  threadDecorations: PluginThreadDecorationDescriptor[];
  publishedState: Record<string, unknown>;
  notifications: PluginNotificationDescriptor[];
  configChangeListeners: Array<(config: AppConfig) => void>;
};

/* ── Plugin Module (what main.js must export) ── */

export type PluginModule = {
  activate: (api: PluginAPI) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
  onConfigChanged?: (config: AppConfig) => void;
};

/* ── Message Hooks ── */

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool-result'; toolCallId: string; result: unknown; isError?: boolean }
  | { type: 'image'; image: string; mimeType?: string }
  | Record<string, unknown>;

export type HookMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessageContent[];
};

export type PreSendHookArgs = {
  messages: HookMessage[];
  modelKey: string;
  config: AppConfig;
};

export type PreSendHookResult = {
  messages: HookMessage[];
  abort?: boolean;
  abortReason?: string;
};

export type PreSendHook = (args: PreSendHookArgs) => Promise<PreSendHookResult> | PreSendHookResult;

export type PostReceiveHookArgs = {
  response: HookMessage;
  messages: HookMessage[];
  config: AppConfig;
};

export type PostReceiveHookResult = {
  response: HookMessage;
};

export type PostReceiveHook = (args: PostReceiveHookArgs) => Promise<PostReceiveHookResult> | PostReceiveHookResult;

/* ── UI Descriptors (JSON-serializable across IPC) ── */

export type PluginBannerDescriptor = {
  id: string;
  pluginName: string;
  component?: string;
  text?: string;
  variant?: 'info' | 'warning' | 'error';
  dismissible?: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

export type PluginModalDescriptor = {
  id: string;
  pluginName: string;
  component: string;
  title?: string;
  closeable: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

export type PluginSettingsSectionDescriptor = {
  id: string;
  pluginName: string;
  label: string;
  component: string;
  priority?: number;
};

export type PluginPanelDescriptor = {
  id: string;
  pluginName: string;
  component: string;
  title: string;
  visible: boolean;
  width?: 'default' | 'wide' | 'full';
  props?: Record<string, unknown>;
};

export type PluginNavigationTarget =
  | { type: 'panel'; panelId: string }
  | { type: 'conversation'; conversationId: string }
  | { type: 'action'; targetId: string; action: string; data?: unknown };

export type PluginNavigationItemDescriptor = {
  id: string;
  pluginName: string;
  label: string;
  icon?: string;
  visible: boolean;
  priority?: number;
  badge?: string | number;
  target: PluginNavigationTarget;
};

export type PluginCommandDescriptor = {
  id: string;
  pluginName: string;
  label: string;
  shortcut?: string;
  visible: boolean;
  priority?: number;
  target: PluginNavigationTarget;
};

export type PluginConversationDecorationDescriptor = {
  id: string;
  pluginName: string;
  conversationId: string;
  label: string;
  variant?: 'info' | 'warning' | 'error' | 'success';
  visible: boolean;
};

export type PluginThreadDecorationDescriptor = {
  id: string;
  pluginName: string;
  conversationId?: string;
  label: string;
  variant?: 'info' | 'warning' | 'error' | 'success';
  visible: boolean;
};

export type PluginRendererScript = {
  pluginName: string;
  scriptPath: string;
  scriptHash: string;
  scriptContent?: string;
};

export type PluginRendererStyle = {
  pluginName: string;
  stylePath: string;
  styleHash: string;
  styleContent?: string;
};

export type PluginNotificationDescriptor = {
  id: string;
  pluginName: string;
  title: string;
  body?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  visible: boolean;
  native?: boolean;
  autoDismissMs?: number;
  target?: PluginNavigationTarget;
};

export type PluginPublishedState = Record<string, Record<string, unknown>>;

export type PluginUIState = {
  banners: PluginBannerDescriptor[];
  modals: PluginModalDescriptor[];
  settingsSections: PluginSettingsSectionDescriptor[];
  panels: PluginPanelDescriptor[];
  navigationItems: PluginNavigationItemDescriptor[];
  commands: PluginCommandDescriptor[];
  conversationDecorations: PluginConversationDecorationDescriptor[];
  threadDecorations: PluginThreadDecorationDescriptor[];
  rendererScripts: PluginRendererScript[];
  rendererStyles: PluginRendererStyle[];
  pluginConfigs: Record<string, Record<string, unknown>>;
  pluginStates: PluginPublishedState;
  notifications: PluginNotificationDescriptor[];
  requiredPluginsReady: boolean;
  brandRequiredPluginNames: string[];
};

/* ── PluginAPI (given to each plugin's activate()) ── */

export type PluginNavigationRequest = {
  pluginName: string;
  target: PluginNavigationTarget;
};

export type PluginConversationRecord = {
  id: string;
  title: string | null;
  fallbackTitle: string | null;
  messages: unknown[];
  messageTree?: unknown[];
  headId?: string | null;
  conversationCompaction: unknown | null;
  lastContextUsage: unknown | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  titleStatus: string;
  titleUpdatedAt: string | null;
  messageCount: number;
  userMessageCount: number;
  runStatus: string;
  hasUnread: boolean;
  lastAssistantUpdateAt: string | null;
  selectedModelKey: string | null;
  selectedProfileKey?: string | null;
  fallbackEnabled?: boolean;
  profilePrimaryModelKey?: string | null;
  currentWorkingDirectory?: string | null;
  selectedBackendKey?: string | null;
  metadata?: Record<string, unknown>;
};

export type PluginConversationAppendMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent[] | string;
  metadata?: Record<string, unknown>;
  parentId?: string | null;
  createdAt?: string;
};

export type PluginAPI = {
  pluginName: string;
  pluginDir: string;

  config: {
    get: () => AppConfig;
    set: (path: string, value: unknown) => void;
    getPluginData: () => Record<string, unknown>;
    setPluginData: (path: string, value: unknown) => void;
    onChanged: (callback: (config: AppConfig) => void) => () => void;
  };

  state: {
    get: () => Record<string, unknown>;
    replace: (next: Record<string, unknown>) => void;
    set: (path: string, value: unknown) => void;
    emitEvent: (eventName: string, data?: unknown) => void;
  };

  tools: {
    register: (tools: ToolDefinition[]) => void;
    unregister: (toolNames: string[]) => void;
  };

  messages: {
    registerPreSendHook: (hook: PreSendHook) => void;
    registerPostReceiveHook: (hook: PostReceiveHook) => void;
  };

  ui: {
    showBanner: (descriptor: Omit<PluginBannerDescriptor, 'pluginName'>) => void;
    hideBanner: (id: string) => void;
    showModal: (descriptor: Omit<PluginModalDescriptor, 'pluginName'>) => void;
    hideModal: (id: string) => void;
    updateModal: (id: string, updates: Partial<Omit<PluginModalDescriptor, 'id' | 'pluginName'>>) => void;
    registerSettingsSection: (descriptor: Omit<PluginSettingsSectionDescriptor, 'pluginName'>) => void;
    registerPanel: (descriptor: Omit<PluginPanelDescriptor, 'pluginName'>) => void;
    registerNavigationItem: (descriptor: Omit<PluginNavigationItemDescriptor, 'pluginName'>) => void;
    registerCommand: (descriptor: Omit<PluginCommandDescriptor, 'pluginName'>) => void;
    showConversationDecoration: (descriptor: Omit<PluginConversationDecorationDescriptor, 'pluginName'>) => void;
    hideConversationDecoration: (id: string) => void;
    showThreadDecoration: (descriptor: Omit<PluginThreadDecorationDescriptor, 'pluginName'>) => void;
    hideThreadDecoration: (id: string) => void;
  };

  notifications: {
    show: (descriptor: Omit<PluginNotificationDescriptor, 'pluginName' | 'visible'>) => void;
    dismiss: (id: string) => void;
  };

  navigation: {
    open: (target: PluginNavigationTarget) => void;
  };

  conversations: {
    list: () => PluginConversationRecord[];
    get: (conversationId: string) => PluginConversationRecord | null;
    upsert: (conversation: PluginConversationRecord) => void;
    setActive: (conversationId: string) => void;
    getActiveId: () => string | null;
    appendMessage: (conversationId: string, message: PluginConversationAppendMessage) => PluginConversationRecord | null;
    markUnread: (conversationId: string, unread: boolean) => void;
  };

  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  shell: {
    openExternal: (url: string) => Promise<void>;
  };

  auth: {
    openAuthWindow: (options: PluginAuthWindowOptions) => Promise<PluginAuthResult>;
  };

  http: {
    listen: (port: number, handler: (req: PluginHttpRequest) => PluginHttpResponse | Promise<PluginHttpResponse>) => Promise<void>;
    close: () => Promise<void>;
  };

  agent: {
    registerBackend: (definition: Omit<AgentBackendDefinition, 'pluginName'>) => void;
    unregisterBackend: (key: string) => void;
  };

  onAction: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => void;

  fetch: typeof globalThis.fetch;
};

export type PluginHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
};

export type PluginHttpResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

/* ── Modal/Banner Actions (renderer → main via IPC) ── */

export type PluginActionPayload = {
  pluginName: string;
  targetId: string;
  action: string;
  data?: unknown;
};

/* ── Auth Window Types ── */

export type PluginAuthWindowOptions = {
  url: string;
  callbackMatch: string;
  title?: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
  successMessage?: string;
  extractParams?: string[];
};

export type PluginAuthResult = {
  success: boolean;
  params?: Record<string, string>;
  error?: string;
};
