import { contextBridge, ipcRenderer } from 'electron';
import type {
  ComputerUseEvent,
  ComputerUsePermissionSection,
  ComputerUseSurface,
} from '../shared/computer-use.js';

export type AppAPI = typeof appAPI;

const appAPI = {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (path: string, value: unknown) => ipcRenderer.invoke('config:set', path, value),
    onChanged: (callback: (config: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, config: unknown) => callback(config);
      ipcRenderer.on('config:changed', handler);
      return () => ipcRenderer.removeListener('config:changed', handler);
    },
  },

  agent: {
    stream: (
      conversationId: string,
      messages: unknown[],
      modelKey?: string,
      reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh',
      profileKey?: string,
      fallbackEnabled?: boolean,
      cwd?: string,
    ) => ipcRenderer.invoke('agent:stream', conversationId, messages, modelKey, reasoningEffort, profileKey, fallbackEnabled, cwd),
    cancelStream: (conversationId: string) => ipcRenderer.invoke('agent:cancel-stream', conversationId),
    generateTitle: (messages: unknown[], modelKey?: string) => ipcRenderer.invoke('agent:generate-title', messages, modelKey),
    listBackends: () => ipcRenderer.invoke('agent:list-backends') as Promise<Array<{
      key: string;
      displayName: string;
      pluginName?: string | null;
    }>>,
    onStreamEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent:stream-event', handler);
      return () => ipcRenderer.removeListener('agent:stream-event', handler);
    },
    sendSubAgentMessage: (subAgentConversationId: string, message: string) =>
      ipcRenderer.invoke('agent:sub-agent-message', subAgentConversationId, message),
    stopSubAgent: (subAgentConversationId: string) =>
      ipcRenderer.invoke('agent:sub-agent-stop', subAgentConversationId),
    listSubAgents: () =>
      ipcRenderer.invoke('agent:sub-agent-list'),
  },

  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id: string) => ipcRenderer.invoke('conversations:get', id),
    put: (conversation: unknown) => ipcRenderer.invoke('conversations:put', conversation),
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
    clear: () => ipcRenderer.invoke('conversations:clear'),
    getActiveId: () => ipcRenderer.invoke('conversations:get-active-id'),
    setActiveId: (id: string) => ipcRenderer.invoke('conversations:set-active-id', id),
    onChanged: (callback: (store: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, store: unknown) => callback(store);
      ipcRenderer.on('conversations:changed', handler);
      return () => ipcRenderer.removeListener('conversations:changed', handler);
    },
  },

  memory: {
    clear: (options: { working?: boolean; observational?: boolean; semantic?: boolean; all?: boolean }) =>
      ipcRenderer.invoke('memory:clear', options) as Promise<{ success?: boolean; cleared?: string[]; error?: string }>,
    testEmbedding: () =>
      ipcRenderer.invoke('memory:test-embedding') as Promise<{ ok?: boolean; model?: string; dimensions?: number; error?: string }>,
  },

  mcp: {
    testConnection: (server: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }) =>
      ipcRenderer.invoke('mcp:test-connection', server) as Promise<{ status: string; toolCount: number; error?: string }>,
  },

  cliTools: {
    checkBinaries: (binaryNames: string[]) =>
      ipcRenderer.invoke('cli-tools:check-binaries', binaryNames) as Promise<Record<string, boolean>>,
  },

  skills: {
    list: () => ipcRenderer.invoke('skills:list') as Promise<Array<{
      name: string;
      description: string;
      version?: string;
      type: string;
      enabled: boolean;
      dir: string;
    }>>,
    get: (name: string) => ipcRenderer.invoke('skills:get', name) as Promise<{
      manifest?: Record<string, unknown>;
      files?: Record<string, string>;
      dir?: string;
      error?: string;
    }>,
    delete: (name: string) => ipcRenderer.invoke('skills:delete', name) as Promise<{ success?: boolean; error?: string }>,
    toggle: (name: string, enable: boolean) => ipcRenderer.invoke('skills:toggle', name, enable) as Promise<{ success?: boolean; enabled?: boolean }>,
  },

  plugins: {
    getUIState: () => ipcRenderer.invoke('plugin:get-ui-state'),
    list: () => ipcRenderer.invoke('plugin:list') as Promise<Array<{
      name: string;
      displayName: string;
      version: string;
      description: string;
      state: string;
      required: boolean;
      error?: string;
    }>>,
    getConfig: (pluginName: string) => ipcRenderer.invoke('plugin:get-config', pluginName) as Promise<Record<string, unknown>>,
    setConfig: (pluginName: string, path: string, value: unknown) =>
      ipcRenderer.invoke('plugin:set-config', pluginName, path, value) as Promise<{ success: boolean }>,
    modalAction: (pluginName: string, modalId: string, action: string, data?: unknown) =>
      ipcRenderer.invoke('plugin:modal-action', pluginName, modalId, action, data),
    bannerAction: (pluginName: string, bannerId: string, action: string, data?: unknown) =>
      ipcRenderer.invoke('plugin:banner-action', pluginName, bannerId, action, data),
    action: (pluginName: string, targetId: string, action: string, data?: unknown) =>
      ipcRenderer.invoke('plugin:action', pluginName, targetId, action, data),
    onUIStateChanged: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('plugin:ui-state-changed', handler);
      return () => ipcRenderer.removeListener('plugin:ui-state-changed', handler);
    },
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('plugin:event', handler);
      return () => ipcRenderer.removeListener('plugin:event', handler);
    },
    onNavigationRequest: (callback: (request: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('plugin:navigation-request', handler);
      return () => ipcRenderer.removeListener('plugin:navigation-request', handler);
    },
    onModalCallback: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('plugin:modal-callback', handler);
      return () => ipcRenderer.removeListener('plugin:modal-callback', handler);
    },
  },

  modelCatalog: () => ipcRenderer.invoke('agent:model-catalog'),

  realtime: {
    startSession: (conversationId: string) =>
      ipcRenderer.invoke('realtime:start-session', conversationId) as Promise<{ ok?: boolean; error?: string }>,
    endSession: () =>
      ipcRenderer.invoke('realtime:end-session') as Promise<{ ok?: boolean }>,
    sendAudio: (pcmBase64: string) =>
      ipcRenderer.send('realtime:send-audio', pcmBase64),
    getStatus: () =>
      ipcRenderer.invoke('realtime:get-status') as Promise<{ status: string }>,
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('realtime:event', handler);
      return () => ipcRenderer.removeListener('realtime:event', handler);
    },
  },

  profileCatalog: () => ipcRenderer.invoke('agent:profiles'),

  dialog: {
    openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
      ipcRenderer.invoke('dialog:open-file', options),
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
    openDirectoryFiles: () => ipcRenderer.invoke('dialog:open-directory-files'),
  },

  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke('clipboard:write-text', text) as Promise<{ ok: boolean; error?: string }>,
  },

  image: {
    fetch: (url: string) => ipcRenderer.invoke('image:fetch', url) as Promise<{ data?: string; mime?: string; error?: string }>,
    save: (url: string, suggestedName?: string) => ipcRenderer.invoke('image:save', url, suggestedName) as Promise<{ canceled?: boolean; filePath?: string; error?: string }>,
  },

  platform: {
    homedir: () => ipcRenderer.invoke('platform:homedir'),
  },

  webServer: {
    getLanAddresses: () => ipcRenderer.invoke('webServer:lan-addresses') as Promise<string[]>,
  },

  fs: {
    listDirectory: (dirPath: string) => ipcRenderer.invoke('fs:list-directory', dirPath) as Promise<{ path?: string; entries: Array<{ name: string; isDirectory: boolean }>; error?: string }>,
  },

  computerUse: {
    startSession: (goal: string, options: unknown) => ipcRenderer.invoke('computer-use:start-session', goal, options),
    pauseSession: (sessionId: string) => ipcRenderer.invoke('computer-use:pause-session', sessionId),
    resumeSession: (sessionId: string) => ipcRenderer.invoke('computer-use:resume-session', sessionId),
    stopSession: (sessionId: string) => ipcRenderer.invoke('computer-use:stop-session', sessionId),
    approveAction: (sessionId: string, actionId: string) => ipcRenderer.invoke('computer-use:approve-action', sessionId, actionId),
    rejectAction: (sessionId: string, actionId: string, reason?: string) => ipcRenderer.invoke('computer-use:reject-action', sessionId, actionId, reason),
    listSessions: () => ipcRenderer.invoke('computer-use:list-sessions'),
    getSession: (sessionId: string) => ipcRenderer.invoke('computer-use:get-session', sessionId),
    setSurface: (sessionId: string, surface: ComputerUseSurface) => ipcRenderer.invoke('computer-use:set-surface', sessionId, surface),
    sendGuidance: (sessionId: string, text: string) => ipcRenderer.invoke('computer-use:send-guidance', sessionId, text),
    updateSessionSettings: (sessionId: string, settings: { modelKey?: string | null; profileKey?: string | null; fallbackEnabled?: boolean; reasoningEffort?: string }) => ipcRenderer.invoke('computer-use:update-session-settings', sessionId, settings),
    continueSession: (sessionId: string, newGoal: string) => ipcRenderer.invoke('computer-use:continue-session', sessionId, newGoal),
    markSessionsSeen: (conversationId: string) => ipcRenderer.invoke('computer-use:mark-sessions-seen', conversationId),
    openSetupWindow: (conversationId?: string | null) => ipcRenderer.invoke('computer-use:open-setup-window', conversationId),
    getLocalMacosPermissions: () => ipcRenderer.invoke('computer-use:get-local-macos-permissions'),
    requestLocalMacosPermissions: () => ipcRenderer.invoke('computer-use:request-local-macos-permissions'),
    requestSingleLocalMacosPermission: (section: ComputerUsePermissionSection) => ipcRenderer.invoke('computer-use:request-single-local-macos-permission', section),
    openLocalMacosPrivacySettings: (section?: ComputerUsePermissionSection) => ipcRenderer.invoke('computer-use:open-local-macos-privacy-settings', section),
    probeInputMonitoring: (timeoutMs?: number) => ipcRenderer.invoke('computer-use:probe-input-monitoring', timeoutMs) as Promise<{ inputMonitoringGranted: boolean }>,
    checkFullScreenApps: () => ipcRenderer.invoke('computer-use:check-fullscreen-apps') as Promise<{ apps: string[]; problematicApps: string[] }>,
    exitFullScreenApps: (appNames: string[]) => ipcRenderer.invoke('computer-use:exit-fullscreen-apps', appNames) as Promise<{ exited: string[]; failed: string[] }>,
    listRunningApps: () => ipcRenderer.invoke('computer-use:list-running-apps') as Promise<{ apps: string[] }>,
    listDisplays: () => ipcRenderer.invoke('computer-use:list-displays') as Promise<{ displays: Array<{ name: string; displayId: string; pixelWidth: number; pixelHeight: number; isPrimary: boolean }> }>,
    focusSession: (sessionId: string) => ipcRenderer.invoke('computer-use:focus-session', sessionId),
    overlayMouseEnter: () => ipcRenderer.send('computer-use:overlay-set-ignore-mouse', false),
    overlayMouseLeave: () => ipcRenderer.send('computer-use:overlay-set-ignore-mouse', true),
    onEvent: (callback: (event: ComputerUseEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: ComputerUseEvent) => callback(data);
      ipcRenderer.on('computer-use:event', handler);
      return () => ipcRenderer.removeListener('computer-use:event', handler);
    },
    onOverlayState: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('computer-use:overlay-state', handler);
      return () => ipcRenderer.removeListener('computer-use:overlay-state', handler);
    },
    onFocusThread: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('computer-use:focus-thread', handler);
      return () => ipcRenderer.removeListener('computer-use:focus-thread', handler);
    },
  },

  mic: {
    listDevices: () => ipcRenderer.invoke('stt:list-devices') as Promise<Array<{ deviceId: string; label: string }>>,
    startRecording: (deviceId?: string) => ipcRenderer.invoke('stt:start-recording', deviceId) as Promise<{ ok?: boolean; silent?: boolean; error?: string }>,
    stopRecording: () => ipcRenderer.invoke('stt:stop-recording') as Promise<{
      wavBase64?: string;
      durationSec?: number;
      maxAmplitude?: number;
      error?: string;
    }>,
    cancelRecording: () => ipcRenderer.invoke('stt:cancel-recording') as Promise<{ ok?: boolean }>,
    startMonitor: (deviceIds?: string[]) => ipcRenderer.invoke('stt:start-monitor', deviceIds) as Promise<Record<string, { ok?: boolean; error?: string }>>,
    getLevel: () => ipcRenderer.invoke('stt:get-level') as Promise<Record<string, number>>,
    stopMonitor: () => ipcRenderer.invoke('stt:stop-monitor') as Promise<{ ok?: boolean }>,
    liveStart: (config: { subscriptionKey: string; region?: string; endpoint?: string; language: string; deviceId?: string }) =>
      ipcRenderer.invoke('stt:live-start', config) as Promise<{ ok?: boolean; error?: string }>,
    liveMicStart: (deviceId?: string) => ipcRenderer.invoke('stt:live-mic-start', deviceId) as Promise<{ ok?: boolean; error?: string }>,
    liveMicDrain: () => ipcRenderer.invoke('stt:live-mic-drain') as Promise<string[]>,
    liveMicStop: () => ipcRenderer.invoke('stt:live-mic-stop') as Promise<{ ok?: boolean }>,
    liveAudio: (pcmBase64: string) => ipcRenderer.send('stt:live-audio', pcmBase64),
    liveStop: () => ipcRenderer.invoke('stt:live-stop') as Promise<{ ok?: boolean }>,
    onPartial: (callback: (text: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
      ipcRenderer.on('stt:partial', handler);
      return () => ipcRenderer.removeListener('stt:partial', handler);
    },
    onFinal: (callback: (text: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
      ipcRenderer.on('stt:final', handler);
      return () => ipcRenderer.removeListener('stt:final', handler);
    },
    onSttError: (callback: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('stt:error', handler);
      return () => ipcRenderer.removeListener('stt:error', handler);
    },
  },

  usage: {
    summary: () => ipcRenderer.invoke('usage:summary'),
    byConversation: (params?: Record<string, unknown>) => ipcRenderer.invoke('usage:by-conversation', params),
    byModel: () => ipcRenderer.invoke('usage:by-model'),
    timeSeries: (params?: Record<string, unknown>) => ipcRenderer.invoke('usage:time-series', params),
    nonLlmEvents: (params?: Record<string, string>) => ipcRenderer.invoke('usage:non-llm-events', params),
    recordEvent: (event: unknown) => ipcRenderer.invoke('usage:record-event', event),
    exportCsv: () => ipcRenderer.invoke('usage:export-csv'),
  },

  onMenuOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:open-settings', handler);
    return () => ipcRenderer.removeListener('menu:open-settings', handler);
  },

  onFind: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu:find', handler);
    return () => ipcRenderer.removeListener('menu:find', handler);
  },

  onModelSwitched: (callback: (modelKey: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, modelKey: string) => callback(modelKey);
    ipcRenderer.on('agent:model-switched', handler);
    return () => ipcRenderer.removeListener('agent:model-switched', handler);
  },
};

contextBridge.exposeInMainWorld('app', appAPI);
