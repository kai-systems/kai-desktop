import type {
  ComputerUseEvent,
  ComputerUsePermissions,
  ComputerUsePermissionRequestResult,
  ComputerUsePermissionSection,
  ComputerUseSurface,
} from '../../shared/computer-use';

type AppAPI = {
  config: {
    get: () => Promise<unknown>;
    set: (path: string, value: unknown) => Promise<unknown>;
    onChanged: (callback: (config: unknown) => void) => () => void;
  };
  agent: {
    stream: (conversationId: string, messages: unknown[], modelKey?: string, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', profileKey?: string, fallbackEnabled?: boolean, cwd?: string) => Promise<unknown>;
    cancelStream: (conversationId: string) => Promise<unknown>;
    generateTitle: (messages: unknown[], modelKey?: string) => Promise<{ title: string | null }>;
    listBackends: () => Promise<Array<{ key: string; displayName: string; pluginName?: string | null }>>;
    onStreamEvent: (callback: (event: unknown) => void) => () => void;
    sendSubAgentMessage: (subAgentConversationId: string, message: string) => Promise<{ ok: boolean }>;
    stopSubAgent: (subAgentConversationId: string) => Promise<{ ok: boolean }>;
    listSubAgents: () => Promise<{ ids: string[] }>;
  };
  conversations: {
    list: () => Promise<unknown[]>;
    get: (id: string) => Promise<unknown>;
    put: (conversation: unknown) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    clear: () => Promise<unknown>;
    getActiveId: () => Promise<string | null>;
    setActiveId: (id: string) => Promise<unknown>;
    onChanged: (callback: (store: unknown) => void) => () => void;
  };
  memory: {
    clear: (options: { working?: boolean; observational?: boolean; semantic?: boolean; all?: boolean }) =>
      Promise<{ success?: boolean; cleared?: string[]; error?: string }>;
    testEmbedding: () =>
      Promise<{ ok?: boolean; model?: string; dimensions?: number; error?: string }>;
  };
  mcp: {
    testConnection: (server: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }) =>
      Promise<{ status: string; toolCount: number; error?: string }>;
  };
  cliTools: {
    checkBinaries: (binaryNames: string[]) => Promise<Record<string, boolean>>;
  };
  skills: {
    list: () => Promise<Array<{
      name: string;
      description: string;
      version?: string;
      type: string;
      enabled: boolean;
      dir: string;
    }>>;
    get: (name: string) => Promise<{
      manifest?: Record<string, unknown>;
      files?: Record<string, string>;
      dir?: string;
      error?: string;
    }>;
    delete: (name: string) => Promise<{ success?: boolean; error?: string }>;
    toggle: (name: string, enable: boolean) => Promise<{ success?: boolean; enabled?: boolean }>;
  };
  plugins: {
    getUIState: () => Promise<unknown>;
    list: () => Promise<Array<{
      name: string;
      displayName: string;
      version: string;
      description: string;
      state: string;
      required: boolean;
      error?: string;
    }>>;
    getConfig: (pluginName: string) => Promise<Record<string, unknown>>;
    setConfig: (pluginName: string, path: string, value: unknown) => Promise<{ success: boolean }>;
    modalAction: (pluginName: string, modalId: string, action: string, data?: unknown) => Promise<unknown>;
    bannerAction: (pluginName: string, bannerId: string, action: string, data?: unknown) => Promise<unknown>;
    action: (pluginName: string, targetId: string, action: string, data?: unknown) => Promise<unknown>;
    onUIStateChanged: (callback: (state: unknown) => void) => () => void;
    onEvent: (callback: (event: unknown) => void) => () => void;
    onNavigationRequest: (callback: (request: unknown) => void) => () => void;
    onModalCallback: (callback: (data: unknown) => void) => () => void;
  };
  modelCatalog: () => Promise<unknown>;
  realtime: {
    startSession: (conversationId: string) => Promise<{ ok?: boolean; error?: string }>;
    endSession: () => Promise<{ ok?: boolean }>;
    sendAudio: (pcmBase64: string) => void;
    getStatus: () => Promise<{ status: string }>;
    onEvent: (callback: (event: unknown) => void) => () => void;
  };
  profileCatalog: () => Promise<{
    profiles: Array<{ key: string; name: string; primaryModelKey: string; fallbackModelKeys: string[] }>;
    defaultKey: string | null;
  }>;
  dialog: {
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<unknown>;
    openDirectory: () => Promise<{ canceled: boolean; directoryPath?: string; name?: string }>;
    openDirectoryFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  clipboard: {
    writeText: (text: string) => Promise<{ ok: boolean; error?: string }>;
  };
  image: {
    fetch: (url: string) => Promise<{ data?: string; mime?: string; error?: string }>;
    save: (url: string, suggestedName?: string) => Promise<{ canceled?: boolean; filePath?: string; error?: string }>;
  };
  platform: {
    homedir: () => Promise<string>;
  };
  computerUse: {
    startSession: (goal: string, options: unknown) => Promise<unknown>;
    pauseSession: (sessionId: string) => Promise<unknown>;
    resumeSession: (sessionId: string) => Promise<unknown>;
    stopSession: (sessionId: string) => Promise<unknown>;
    approveAction: (sessionId: string, actionId: string) => Promise<unknown>;
    rejectAction: (sessionId: string, actionId: string, reason?: string) => Promise<unknown>;
    listSessions: () => Promise<unknown[]>;
    getSession: (sessionId: string) => Promise<unknown>;
    setSurface: (sessionId: string, surface: ComputerUseSurface) => Promise<unknown>;
    sendGuidance: (sessionId: string, text: string) => Promise<unknown>;
    updateSessionSettings: (sessionId: string, settings: { modelKey?: string | null; profileKey?: string | null; fallbackEnabled?: boolean; reasoningEffort?: string }) => Promise<unknown>;
    continueSession: (sessionId: string, newGoal: string) => Promise<unknown>;
    markSessionsSeen: (conversationId: string) => Promise<unknown>;
    openSetupWindow: (conversationId?: string | null) => Promise<unknown>;
    getLocalMacosPermissions: () => Promise<ComputerUsePermissions>;
    requestLocalMacosPermissions: () => Promise<ComputerUsePermissionRequestResult>;
    requestSingleLocalMacosPermission: (section: ComputerUsePermissionSection) => Promise<ComputerUsePermissions>;
    openLocalMacosPrivacySettings: (section?: ComputerUsePermissionSection) => Promise<{ opened: ComputerUsePermissionSection | null }>;
    probeInputMonitoring: (timeoutMs?: number) => Promise<{ inputMonitoringGranted: boolean }>;
    checkFullScreenApps: () => Promise<{ apps: string[]; problematicApps: string[] }>;
    exitFullScreenApps: (appNames: string[]) => Promise<{ exited: string[]; failed: string[] }>;
    listRunningApps: () => Promise<{ apps: string[] }>;
    listDisplays: () => Promise<{ displays: Array<{ name: string; displayId: string; pixelWidth: number; pixelHeight: number; isPrimary: boolean }> }>;
    focusSession: (sessionId: string) => Promise<unknown>;
    overlayMouseEnter: () => void;
    overlayMouseLeave: () => void;
    onEvent: (callback: (event: ComputerUseEvent) => void) => () => void;
    onOverlayState: (callback: (state: unknown) => void) => () => void;
    onFocusThread: (callback: () => void) => () => void;
  };
  mic: {
    listDevices: () => Promise<Array<{ deviceId: string; label: string }>>;
    startRecording: (deviceId?: string) => Promise<{ ok?: boolean; silent?: boolean; error?: string }>;
    stopRecording: () => Promise<{
      wavBase64?: string;
      durationSec?: number;
      maxAmplitude?: number;
      error?: string;
    }>;
    cancelRecording: () => Promise<{ ok?: boolean }>;
    startMonitor: (deviceIds?: string[]) => Promise<Record<string, { ok?: boolean; error?: string }>>;
    getLevel: () => Promise<Record<string, number>>;
    stopMonitor: () => Promise<{ ok?: boolean }>;
    liveStart: (config: { subscriptionKey: string; region?: string; endpoint?: string; language: string; deviceId?: string }) => Promise<{ ok?: boolean; error?: string }>;
    liveMicStart: (deviceId?: string) => Promise<{ ok?: boolean; error?: string }>;
    liveMicDrain: () => Promise<string[]>;
    liveMicStop: () => Promise<{ ok?: boolean }>;
    liveAudio: (pcmBase64: string) => void;
    liveStop: () => Promise<{ ok?: boolean }>;
    onPartial: (callback: (text: string) => void) => () => void;
    onFinal: (callback: (text: string) => void) => () => void;
    onSttError: (callback: (error: string) => void) => () => void;
  };
  usage: {
    summary: () => Promise<unknown>;
    byConversation: (params?: Record<string, unknown>) => Promise<unknown>;
    byModel: () => Promise<unknown>;
    timeSeries: (params?: Record<string, unknown>) => Promise<unknown>;
    nonLlmEvents: (params?: Record<string, string>) => Promise<unknown>;
    recordEvent: (event: unknown) => Promise<unknown>;
    exportCsv: () => Promise<unknown>;
  };
  onMenuOpenSettings: (callback: () => void) => () => void;
  onFind: (callback: () => void) => () => void;
  onModelSwitched: (callback: (modelKey: string) => void) => () => void;
};

declare global {
  interface Window {
    app?: AppAPI;
  }
}

function getApp(): AppAPI {
  if (!window.app) {
    throw new Error(__BRAND_PRODUCT_NAME + ' IPC bridge not available. Ensure the app is running in Electron.');
  }
  return window.app;
}

export const app: AppAPI = new Proxy({} as AppAPI, {
  get(_target, prop: string) {
    const api = getApp();
    return (api as Record<string, unknown>)[prop];
  },
});
