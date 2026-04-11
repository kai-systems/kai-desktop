import React, { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { app } from '@/lib/ipc-client';
import { registerPluginComponents, type PluginComponent } from '@/components/plugins/PluginComponentRegistry';

const isWebBridge = Boolean(
  (window as unknown as Record<string, unknown>).app &&
    (window.app as Record<string, unknown>).__isWebBridge,
);

/**
 * Rewrite plugin-renderer:// protocol URLs to /plugin-renderer/ HTTP paths
 * when running in web mode so they are served by the web server.
 */
function rewritePluginUrl(url: string): string {
  if (!isWebBridge) return url;
  const prefix = 'plugin-renderer://';
  if (!url.startsWith(prefix)) return url;
  // plugin-renderer://pluginName/fileHash/path → /plugin-renderer/pluginName/fileHash/path
  return '/plugin-renderer/' + url.slice(prefix.length);
}

type PluginBannerDescriptor = {
  id: string;
  pluginName: string;
  component?: string;
  text?: string;
  variant?: 'info' | 'warning' | 'error';
  dismissible?: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

type PluginModalDescriptor = {
  id: string;
  pluginName: string;
  component: string;
  title?: string;
  closeable: boolean;
  visible: boolean;
  props?: Record<string, unknown>;
};

type PluginSettingsSectionDescriptor = {
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

type PluginRendererScript = {
  pluginName: string;
  scriptPath: string;
  scriptHash: string;
  entryUrl: string;
};

type PluginRendererStyle = {
  pluginName: string;
  stylePath: string;
  styleHash: string;
  styleUrl?: string;
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
  pluginStates: Record<string, Record<string, unknown>>;
  pluginStatuses: Record<string, 'loading' | 'active' | 'error' | 'disabled'>;
  pluginErrors: Record<string, string | undefined>;
  notifications: PluginNotificationDescriptor[];
  requiredPluginsReady: boolean;
  brandRequiredPluginNames: string[];
};

type ModalCallbackData = {
  pluginName: string;
  modalId: string;
  data: unknown;
};

type PluginEventRecord = {
  pluginName: string;
  eventName: string;
  data: unknown;
  receivedAt: number;
};

type PluginRendererStatus = 'idle' | 'loading' | 'ready' | 'error';

type PluginNavigationRequestRecord = {
  pluginName: string;
  target: PluginNavigationTarget;
  receivedAt: number;
};

type PluginContextValue = {
  uiState: PluginUIState | null;
  modalCallbacks: ModalCallbackData[];
  pluginEvents: PluginEventRecord[];
  navigationRequests: PluginNavigationRequestRecord[];
  rendererLoadCount: number;
  getPluginStatus: (pluginName: string) => 'loading' | 'active' | 'error' | 'disabled';
  getPluginError: (pluginName: string) => string | null;
  hasRendererScript: (pluginName: string) => boolean;
  getPluginRendererStatus: (pluginName: string) => PluginRendererStatus;
  getPluginRendererError: (pluginName: string) => string | null;
  sendModalAction: (pluginName: string, modalId: string, action: string, data?: unknown) => Promise<unknown>;
  sendBannerAction: (pluginName: string, bannerId: string, action: string, data?: unknown) => Promise<unknown>;
  sendAction: (pluginName: string, targetId: string, action: string, data?: unknown) => Promise<unknown>;
  getPluginConfig: (pluginName: string) => Promise<Record<string, unknown>>;
  getResolvedPluginConfig: (pluginName: string) => Record<string, unknown>;
  getPluginState: (pluginName: string) => Record<string, unknown>;
  setPluginConfig: (pluginName: string, path: string, value: unknown) => Promise<void>;
  consumeModalCallback: (pluginName: string, modalId: string) => ModalCallbackData | null;
  consumeNavigationRequest: () => PluginNavigationRequestRecord | null;
  consumePluginEvent: (pluginName?: string, eventName?: string) => PluginEventRecord | null;
};

const PluginContext = createContext<PluginContextValue>({
  uiState: null,
  modalCallbacks: [],
  pluginEvents: [],
  navigationRequests: [],
  rendererLoadCount: 0,
  getPluginStatus: () => 'disabled',
  getPluginError: () => null,
  hasRendererScript: () => false,
  getPluginRendererStatus: () => 'idle',
  getPluginRendererError: () => null,
  sendModalAction: async () => null,
  sendBannerAction: async () => null,
  sendAction: async () => null,
  getPluginConfig: async () => ({}),
  getResolvedPluginConfig: () => ({}),
  getPluginState: () => ({}),
  setPluginConfig: async () => {},
  consumeModalCallback: () => null,
  consumeNavigationRequest: () => null,
  consumePluginEvent: () => null,
});

function loadPluginRendererScripts(
  scripts: PluginRendererScript[],
  loadedRef: Map<string, string>,
  onStatusChange: (pluginName: string, status: PluginRendererStatus, error?: string | null) => void,
  onLoaded: () => void,
): void {
  for (const { pluginName, entryUrl, scriptHash } of scripts) {
    const cacheKey = `${scriptHash}:${entryUrl}`;
    if (loadedRef.get(pluginName) === cacheKey) continue;
    loadedRef.set(pluginName, cacheKey);
    onStatusChange(pluginName, 'loading', null);

    try {
      import(/* @vite-ignore */ rewritePluginUrl(entryUrl))
        .then((mod) => {
          if (typeof mod.register === 'function') {
            mod.register({
              React,
              registerComponents: (name: string, components: Record<string, unknown>) => {
                registerPluginComponents(name, components as Record<string, PluginComponent>);
              },
            });
            onStatusChange(pluginName, 'ready', null);
            onLoaded();
          } else {
            onStatusChange(pluginName, 'error', 'Renderer module has no register() export');
            console.warn(`[PluginProvider] Renderer for "${pluginName}" has no register() export`);
          }
        })
        .catch((err) => {
          onStatusChange(pluginName, 'error', err instanceof Error ? err.message : String(err));
          console.error(`[PluginProvider] Failed to import renderer for "${pluginName}":`, err);
        });
    } catch (err) {
      onStatusChange(pluginName, 'error', err instanceof Error ? err.message : String(err));
      console.error(`[PluginProvider] Failed to load renderer for "${pluginName}":`, err);
    }
  }
}

function applyPluginRendererStyles(
  styles: PluginRendererStyle[],
  loadedRef: Map<string, string>,
): void {
  for (const { pluginName, stylePath, styleHash, styleContent, styleUrl } of styles) {
    if (!styleContent && !styleUrl) continue;
    const key = `${pluginName}:${stylePath}`;
    const cacheKey = `${styleHash}:${styleUrl ?? stylePath}`;
    if (loadedRef.get(key) === cacheKey) continue;
    loadedRef.set(key, cacheKey);

    const elementId = `plugin-style-${pluginName}-${btoa(stylePath).replace(/=/g, '')}`;
    const existingElement = document.getElementById(elementId);

    if (styleUrl) {
      let linkElement = existingElement as HTMLLinkElement | null;
      if (!linkElement || linkElement.tagName !== 'LINK') {
        existingElement?.remove();
        linkElement = document.createElement('link');
        linkElement.id = elementId;
        linkElement.rel = 'stylesheet';
        document.head.appendChild(linkElement);
      }
      linkElement.href = rewritePluginUrl(styleUrl);
      continue;
    }

    let styleElement = existingElement as HTMLStyleElement | null;
    if (!styleElement || styleElement.tagName !== 'STYLE') {
      existingElement?.remove();
      styleElement = document.createElement('style');
      styleElement.id = elementId;
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = styleContent ?? '';
  }
}

export function PluginProvider({ children }: { children: ReactNode }) {
  const [uiState, setUIState] = useState<PluginUIState | null>(null);
  const [modalCallbacks, setModalCallbacks] = useState<ModalCallbackData[]>([]);
  const [pluginEvents, setPluginEvents] = useState<PluginEventRecord[]>([]);
  const [navigationRequests, setNavigationRequests] = useState<PluginNavigationRequestRecord[]>([]);
  const [rendererLoadCount, setRendererLoadCount] = useState(0);
  const [rendererStatuses, setRendererStatuses] = useState<Record<string, PluginRendererStatus>>({});
  const [rendererErrors, setRendererErrors] = useState<Record<string, string | null>>({});
  const loadedRenderers = useRef(new Map<string, string>());
  const loadedStyles = useRef(new Map<string, string>());

  const onRendererLoaded = useCallback(() => {
    setRendererLoadCount((count) => count + 1);
  }, []);

  const updateRendererStatus = useCallback((pluginName: string, status: PluginRendererStatus, error?: string | null) => {
    setRendererStatuses((current) => {
      if (current[pluginName] === status) return current;
      return {
        ...current,
        [pluginName]: status,
      };
    });
    setRendererErrors((current) => {
      const nextError = error ?? null;
      if ((current[pluginName] ?? null) === nextError) return current;
      return {
        ...current,
        [pluginName]: nextError,
      };
    });
  }, []);

  useEffect(() => {
    app.plugins.getUIState()
      .then((state) => {
        const typed = state as PluginUIState;
        setUIState(typed);
        if (typed.rendererScripts?.length) {
          loadPluginRendererScripts(typed.rendererScripts, loadedRenderers.current, updateRendererStatus, onRendererLoaded);
        }
        if (typed.rendererStyles?.length) {
          applyPluginRendererStyles(typed.rendererStyles, loadedStyles.current);
        }
      })
      .catch((err) => console.error('[PluginProvider] Failed to get UI state:', err));

    const unsubUI = app.plugins.onUIStateChanged((state) => {
      const typed = state as PluginUIState;
      setUIState(typed);
      if (typed.rendererScripts?.length) {
        loadPluginRendererScripts(typed.rendererScripts, loadedRenderers.current, updateRendererStatus, onRendererLoaded);
      }
      if (typed.rendererStyles?.length) {
        applyPluginRendererStyles(typed.rendererStyles, loadedStyles.current);
      }
    });

    const unsubEvent = app.plugins.onEvent((event) => {
      const typed = event as { pluginName?: string; eventName?: string; data?: unknown };
      setPluginEvents((prev) => [
        ...prev.slice(-49),
        {
          pluginName: typed.pluginName ?? '',
          eventName: typed.eventName ?? 'event',
          data: typed.data,
          receivedAt: Date.now(),
        },
      ]);
    });

    const unsubNavigation = app.plugins.onNavigationRequest((request) => {
      const typed = request as { pluginName?: string; target?: PluginNavigationTarget };
      const target = typed.target;
      if (!target) return;
      setNavigationRequests((prev) => [
        ...prev.slice(-19),
        {
          pluginName: typed.pluginName ?? '',
          target,
          receivedAt: Date.now(),
        },
      ]);
    });

    const unsubCallback = app.plugins.onModalCallback((data) => {
      setModalCallbacks((prev) => [...prev, data as ModalCallbackData]);
    });

    return () => {
      unsubUI();
      unsubEvent();
      unsubNavigation();
      unsubCallback();
    };
  }, [onRendererLoaded, updateRendererStatus]);

  const hasRendererScript = useCallback(
    (pluginName: string) => uiState?.rendererScripts?.some((script) => script.pluginName === pluginName) ?? false,
    [uiState],
  );

  const getPluginStatus = useCallback(
    (pluginName: string): 'loading' | 'active' | 'error' | 'disabled' => uiState?.pluginStatuses?.[pluginName] ?? 'disabled',
    [uiState],
  );

  const getPluginError = useCallback(
    (pluginName: string): string | null => uiState?.pluginErrors?.[pluginName] ?? null,
    [uiState],
  );

  const getPluginRendererStatus = useCallback(
    (pluginName: string): PluginRendererStatus => {
      const pluginStatus = getPluginStatus(pluginName);
      if (pluginStatus === 'loading') return 'loading';
      if (pluginStatus === 'error') return 'error';
      if (rendererStatuses[pluginName]) return rendererStatuses[pluginName];
      return hasRendererScript(pluginName) ? 'loading' : 'idle';
    },
    [getPluginStatus, hasRendererScript, rendererStatuses],
  );

  const getPluginRendererError = useCallback(
    (pluginName: string): string | null => rendererErrors[pluginName] ?? null,
    [rendererErrors],
  );

  const sendModalAction = useCallback(
    (pluginName: string, modalId: string, action: string, data?: unknown) =>
      app.plugins.modalAction(pluginName, modalId, action, data),
    [],
  );

  const sendBannerAction = useCallback(
    (pluginName: string, bannerId: string, action: string, data?: unknown) =>
      app.plugins.bannerAction(pluginName, bannerId, action, data),
    [],
  );

  const sendAction = useCallback(
    (pluginName: string, targetId: string, action: string, data?: unknown) =>
      app.plugins.action(pluginName, targetId, action, data),
    [],
  );

  const getPluginConfig = useCallback(
    (pluginName: string) => app.plugins.getConfig(pluginName),
    [],
  );

  const getResolvedPluginConfig = useCallback(
    (pluginName: string) => uiState?.pluginConfigs?.[pluginName] ?? {},
    [uiState],
  );

  const getPluginState = useCallback(
    (pluginName: string) => uiState?.pluginStates?.[pluginName] ?? {},
    [uiState],
  );

  const setPluginConfig = useCallback(
    async (pluginName: string, path: string, value: unknown) => {
      await app.plugins.setConfig(pluginName, path, value);
    },
    [],
  );

  const consumeModalCallback = useCallback(
    (pluginName: string, modalId: string): ModalCallbackData | null => {
      let found: ModalCallbackData | null = null;
      setModalCallbacks((prev) => {
        const idx = prev.findIndex((cb) => cb.pluginName === pluginName && cb.modalId === modalId);
        if (idx >= 0) {
          found = prev[idx];
          return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        }
        return prev;
      });
      return found;
    },
    [],
  );

  const consumeNavigationRequest = useCallback((): PluginNavigationRequestRecord | null => {
    let found: PluginNavigationRequestRecord | null = null;
    setNavigationRequests((prev) => {
      if (prev.length === 0) return prev;
      found = prev[0];
      return prev.slice(1);
    });
    return found;
  }, []);

  const consumePluginEvent = useCallback((pluginName?: string, eventName?: string): PluginEventRecord | null => {
    let found: PluginEventRecord | null = null;
    setPluginEvents((prev) => {
      const index = prev.findIndex((event) => {
        if (pluginName && event.pluginName !== pluginName) return false;
        if (eventName && event.eventName !== eventName) return false;
        return true;
      });
      if (index < 0) return prev;
      found = prev[index];
      return [...prev.slice(0, index), ...prev.slice(index + 1)];
    });
    return found;
  }, []);

  return (
    <PluginContext.Provider
      value={{
        uiState,
        modalCallbacks,
        pluginEvents,
        navigationRequests,
        rendererLoadCount,
        getPluginStatus,
        getPluginError,
        hasRendererScript,
        getPluginRendererStatus,
        getPluginRendererError,
        sendModalAction,
        sendBannerAction,
        sendAction,
        getPluginConfig,
        getResolvedPluginConfig,
        getPluginState,
        setPluginConfig,
        consumeModalCallback,
        consumeNavigationRequest,
        consumePluginEvent,
      }}
    >
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins() {
  return useContext(PluginContext);
}
