import { shell, BrowserWindow } from 'electron';
import { applyBrandUserAgent } from '../utils/user-agent.js';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';
import { URL } from 'url';
import { z } from 'zod';
import type {
  PluginAPI,
  PluginInstance,
  PluginBannerDescriptor,
  PluginModalDescriptor,
  PluginSettingsSectionDescriptor,
  PluginPanelDescriptor,
  PluginNavigationItemDescriptor,
  PluginCommandDescriptor,
  PluginConversationDecorationDescriptor,
  PluginThreadDecorationDescriptor,
  PluginNotificationDescriptor,
  PluginAuthWindowOptions,
  PluginAuthResult,
  PluginConversationAppendMessage,
  PluginConversationRecord,
  PluginHttpRequest,
  PluginHttpResponse,
  PreSendHook,
  PostReceiveHook,
  PluginNavigationTarget,
  MessageContent,
} from './types.js';
import type { AppConfig } from '../config/schema.js';
import type { ToolDefinition } from '../tools/types.js';
import { buildScopedToolName, getScopedToolPrefix } from '../tools/naming.js';
import { convertJsonSchemaToZod } from '../tools/skill-loader.js';
import { registerAgentBackend, unregisterAgentBackend } from '../agent/backend-registry.js';
import { readConversationStore, writeConversationStore, broadcastConversationChange } from '../ipc/conversations.js';

type PluginAPICallbacks = {
  appHome: string;
  getConfig: () => AppConfig;
  setConfig: (path: string, value: unknown) => void;
  getPluginConfig: () => Record<string, unknown>;
  setPluginConfig: (path: string, value: unknown) => void;
  getPluginState: () => Record<string, unknown>;
  replacePluginState: (next: Record<string, unknown>) => void;
  setPluginState: (path: string, value: unknown) => void;
  emitPluginEvent: (eventName: string, data?: unknown) => void;
  showNotification: (descriptor: Omit<PluginNotificationDescriptor, 'pluginName' | 'visible'>) => void;
  dismissNotification: (id: string) => void;
  openNavigationTarget: (target: PluginNavigationTarget) => void;
  onUIStateChanged: () => void;
  onToolsChanged: () => void;
  registerActionHandler: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => void;
};

function isZodSchema(schema: unknown): schema is z.ZodTypeAny {
  return Boolean(
    schema
    && typeof schema === 'object'
    && typeof (schema as { safeParse?: unknown }).safeParse === 'function',
  );
}

function normalizePluginTool(tool: ToolDefinition): ToolDefinition {
  const rawSchema = tool.inputSchema as unknown;
  const inputSchema = isZodSchema(rawSchema)
    ? rawSchema
    : rawSchema && typeof rawSchema === 'object'
      ? convertJsonSchemaToZod(rawSchema as Record<string, unknown>)
      : z.object({}).passthrough();

  return {
    ...tool,
    inputSchema,
  };
}

function resolvePluginToolOriginalName(pluginName: string, tool: ToolDefinition): string {
  if (tool.source === 'plugin' && tool.sourceId === pluginName && tool.originalName) {
    return tool.originalName;
  }

  const legacyPrefix = `plugin:${pluginName}:`;
  if (tool.name.startsWith(legacyPrefix)) {
    return tool.name.slice(legacyPrefix.length);
  }

  const safePrefix = getScopedToolPrefix('plugin', pluginName);
  if (tool.name.startsWith(safePrefix)) {
    return tool.name.slice(safePrefix.length);
  }

  return tool.originalName ?? tool.name;
}

function normalizePluginObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

type StoredConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent[] | string;
  parentId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

function normalizeConversationRole(role: PluginConversationAppendMessage['role']): StoredConversationMessage['role'] {
  return role;
}

function getConversationBranch(
  tree: StoredConversationMessage[],
  headId: string | null,
): StoredConversationMessage[] {
  if (!headId) return [];

  const byId = new Map(tree.map((message) => [message.id, message] as const));
  const branch: StoredConversationMessage[] = [];
  let currentId: string | null = headId;

  while (currentId) {
    const current = byId.get(currentId);
    if (!current) break;
    branch.push(current);
    currentId = current.parentId;
  }

  return branch.reverse();
}

function ensureConversationTree(
  conversation: PluginConversationRecord,
): { tree: StoredConversationMessage[]; headId: string | null } {
  const rawTree = Array.isArray(conversation.messageTree)
    ? conversation.messageTree as StoredConversationMessage[]
    : null;

  if (rawTree && rawTree.length > 0) {
    return {
      tree: rawTree,
      headId: conversation.headId ?? rawTree[rawTree.length - 1]?.id ?? null,
    };
  }

  let parentId: string | null = null;
  const tree = (Array.isArray(conversation.messages) ? conversation.messages : []).map((message, index) => {
    const typed = normalizePluginObject(message) as StoredConversationMessage;
    const id = typeof typed.id === 'string' && typed.id
      ? typed.id
      : `plugin-msg-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    const normalized: StoredConversationMessage = {
      id,
      role: normalizeConversationRole(
        typed.role === 'user' || typed.role === 'assistant' || typed.role === 'system' || typed.role === 'tool'
          ? typed.role
          : 'assistant',
      ),
      content: (typed.content as MessageContent[] | string | undefined) ?? '',
      parentId,
      createdAt: typeof typed.createdAt === 'string' ? typed.createdAt : new Date().toISOString(),
      metadata: typed.metadata && typeof typed.metadata === 'object'
        ? typed.metadata
        : undefined,
    };
    parentId = normalized.id;
    return normalized;
  });

  return {
    tree,
    headId: tree[tree.length - 1]?.id ?? null,
  };
}

function normalizeConversationRecord(
  conversation: PluginConversationRecord,
): PluginConversationRecord {
  const { tree, headId } = ensureConversationTree(conversation);
  const branch = getConversationBranch(tree, headId);

  return {
    ...conversation,
    messages: branch,
    messageTree: tree,
    headId,
    messageCount: branch.length,
    userMessageCount: branch.filter((message) => message.role === 'user').length,
  };
}

function listPermission(instance: PluginInstance): string {
  return instance.manifest.permissions.join(', ') || 'none';
}

export function createPluginAPI(
  instance: PluginInstance,
  callbacks: PluginAPICallbacks,
): PluginAPI {
  const { manifest } = instance;
  let httpServer: Server | null = null;

  const requirePermission = (permission: string): void => {
    if (!manifest.permissions.includes(permission as typeof manifest.permissions[number])) {
      throw new Error(`Plugin "${manifest.name}" requires permission "${permission}" for this action. Declared: ${listPermission(instance)}`);
    }
  };

  const registerOrReplace = <T extends { id: string }>(items: T[], descriptor: T): void => {
    const index = items.findIndex((item) => item.id === descriptor.id);
    if (index >= 0) {
      items[index] = descriptor;
    } else {
      items.push(descriptor);
    }
    callbacks.onUIStateChanged();
  };

  const api: PluginAPI = {
    pluginName: manifest.name,
    pluginDir: instance.dir,

    config: {
      get: () => {
        requirePermission('config:read');
        return callbacks.getConfig();
      },

      set: (path: string, value: unknown) => {
        requirePermission('config:write');
        callbacks.setConfig(path, value);
      },

      getPluginData: () => {
        requirePermission('config:read');
        return callbacks.getPluginConfig();
      },

      setPluginData: (path: string, value: unknown) => {
        requirePermission('config:write');
        callbacks.setPluginConfig(path, value);
      },

      onChanged: (callback: (config: AppConfig) => void) => {
        requirePermission('config:read');
        instance.configChangeListeners.push(callback);
        return () => {
          const idx = instance.configChangeListeners.indexOf(callback);
          if (idx >= 0) instance.configChangeListeners.splice(idx, 1);
        };
      },
    },

    state: {
      get: () => callbacks.getPluginState(),
      replace: (next: Record<string, unknown>) => {
        requirePermission('state:publish');
        callbacks.replacePluginState(normalizePluginObject(next));
      },
      set: (path: string, value: unknown) => {
        requirePermission('state:publish');
        callbacks.setPluginState(path, value);
      },
      emitEvent: (eventName: string, data?: unknown) => {
        requirePermission('state:publish');
        callbacks.emitPluginEvent(eventName, data);
      },
    },

    tools: {
      register: (tools: ToolDefinition[]) => {
        requirePermission('tools:register');
        const prefixed = tools.map((tool) => normalizePluginTool(tool)).map((tool) => {
          const originalName = resolvePluginToolOriginalName(manifest.name, tool);

          return {
            ...tool,
            name: buildScopedToolName('plugin', manifest.name, originalName),
            source: 'plugin' as const,
            sourceId: manifest.name,
            originalName,
            aliases: Array.from(new Set([
              ...(tool.aliases ?? []),
              tool.name,
              `plugin:${manifest.name}:${originalName}`,
            ])),
          };
        });
        const newNames = new Set(prefixed.map((tool) => tool.name));
        instance.registeredTools = instance.registeredTools.filter((tool) => !newNames.has(tool.name));
        instance.registeredTools.push(...prefixed);
        callbacks.onToolsChanged();
      },

      unregister: (toolNames: string[]) => {
        requirePermission('tools:register');
        const fullNames = new Set(
          toolNames.flatMap((name) => {
            const originalName = name.startsWith(`plugin:${manifest.name}:`)
              ? name.slice(`plugin:${manifest.name}:`.length)
              : name;

            return [
              name,
              `plugin:${manifest.name}:${originalName}`,
              buildScopedToolName('plugin', manifest.name, originalName),
            ];
          }),
        );
        instance.registeredTools = instance.registeredTools.filter(
          (tool) => !fullNames.has(tool.name) && !(tool.aliases?.some((alias) => fullNames.has(alias))),
        );
        callbacks.onToolsChanged();
      },
    },

    messages: {
      registerPreSendHook: (hook: PreSendHook) => {
        requirePermission('messages:hook');
        instance.preSendHooks.push(hook);
      },

      registerPostReceiveHook: (hook: PostReceiveHook) => {
        requirePermission('messages:hook');
        instance.postReceiveHooks.push(hook);
      },
    },

    ui: {
      showBanner: (descriptor: Omit<PluginBannerDescriptor, 'pluginName'>) => {
        requirePermission('ui:banner');
        registerOrReplace(instance.uiBanners, { ...descriptor, pluginName: manifest.name });
      },

      hideBanner: (id: string) => {
        requirePermission('ui:banner');
        const idx = instance.uiBanners.findIndex((banner) => banner.id === id);
        if (idx >= 0) {
          instance.uiBanners[idx] = { ...instance.uiBanners[idx], visible: false };
          callbacks.onUIStateChanged();
        }
      },

      showModal: (descriptor: Omit<PluginModalDescriptor, 'pluginName'>) => {
        requirePermission('ui:modal');
        registerOrReplace(instance.uiModals, { ...descriptor, pluginName: manifest.name });
      },

      hideModal: (id: string) => {
        requirePermission('ui:modal');
        const idx = instance.uiModals.findIndex((modal) => modal.id === id);
        if (idx >= 0) {
          instance.uiModals[idx] = { ...instance.uiModals[idx], visible: false };
          callbacks.onUIStateChanged();
        }
      },

      updateModal: (id: string, updates: Partial<Omit<PluginModalDescriptor, 'id' | 'pluginName'>>) => {
        requirePermission('ui:modal');
        const idx = instance.uiModals.findIndex((modal) => modal.id === id);
        if (idx >= 0) {
          instance.uiModals[idx] = { ...instance.uiModals[idx], ...updates };
          callbacks.onUIStateChanged();
        }
      },

      registerSettingsSection: (descriptor: Omit<PluginSettingsSectionDescriptor, 'pluginName'>) => {
        requirePermission('ui:settings');
        registerOrReplace(instance.uiSettingsSections, { ...descriptor, pluginName: manifest.name });
      },

      registerPanel: (descriptor: Omit<PluginPanelDescriptor, 'pluginName'>) => {
        requirePermission('ui:panel');
        registerOrReplace(instance.uiPanels, { ...descriptor, pluginName: manifest.name });
      },

      registerNavigationItem: (descriptor: Omit<PluginNavigationItemDescriptor, 'pluginName'>) => {
        requirePermission('ui:navigation');
        registerOrReplace(instance.uiNavigationItems, { ...descriptor, pluginName: manifest.name });
      },

      registerCommand: (descriptor: Omit<PluginCommandDescriptor, 'pluginName'>) => {
        requirePermission('ui:navigation');
        registerOrReplace(instance.uiCommands, { ...descriptor, pluginName: manifest.name });
      },

      showConversationDecoration: (descriptor: Omit<PluginConversationDecorationDescriptor, 'pluginName'>) => {
        requirePermission('ui:navigation');
        registerOrReplace(instance.conversationDecorations, { ...descriptor, pluginName: manifest.name });
      },

      hideConversationDecoration: (id: string) => {
        requirePermission('ui:navigation');
        const idx = instance.conversationDecorations.findIndex((decoration) => decoration.id === id);
        if (idx >= 0) {
          instance.conversationDecorations[idx] = { ...instance.conversationDecorations[idx], visible: false };
          callbacks.onUIStateChanged();
        }
      },

      showThreadDecoration: (descriptor: Omit<PluginThreadDecorationDescriptor, 'pluginName'>) => {
        requirePermission('ui:navigation');
        registerOrReplace(instance.threadDecorations, { ...descriptor, pluginName: manifest.name });
      },

      hideThreadDecoration: (id: string) => {
        requirePermission('ui:navigation');
        const idx = instance.threadDecorations.findIndex((decoration) => decoration.id === id);
        if (idx >= 0) {
          instance.threadDecorations[idx] = { ...instance.threadDecorations[idx], visible: false };
          callbacks.onUIStateChanged();
        }
      },
    },

    notifications: {
      show: (descriptor) => {
        requirePermission('notifications:send');
        callbacks.showNotification(descriptor);
      },
      dismiss: (id: string) => {
        requirePermission('notifications:send');
        callbacks.dismissNotification(id);
      },
    },

    navigation: {
      open: (target) => {
        requirePermission('navigation:open');
        callbacks.openNavigationTarget(target);
      },
    },

    conversations: {
      list: () => {
        requirePermission('conversations:read');
        return [];
      },
      get: (_conversationId: string) => null,
      upsert: (_conversation: PluginConversationRecord) => {},
      setActive: (_conversationId: string) => {},
      getActiveId: () => null,
      appendMessage: (_conversationId: string, _message: PluginConversationAppendMessage) => null,
      markUnread: (_conversationId: string, _unread: boolean) => {},
    },

    log: {
      info: (...args: unknown[]) => console.info(`[Plugin:${manifest.name}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[Plugin:${manifest.name}]`, ...args),
      error: (...args: unknown[]) => console.error(`[Plugin:${manifest.name}]`, ...args),
    },

    shell: {
      openExternal: (url: string) => {
        requirePermission('navigation:open');
        return shell.openExternal(url);
      },
    },

    auth: {
      openAuthWindow: (options: PluginAuthWindowOptions): Promise<PluginAuthResult> => {
        requirePermission('auth:window');
        const {
          url,
          callbackMatch,
          title = 'Sign In',
          width = 620,
          height = 720,
          timeoutMs = 300_000,
          successMessage,
          extractParams,
        } = options;

        return new Promise((resolve) => {
          let settled = false;

          const authWin = new BrowserWindow({
            width,
            height,
            show: true,
            title,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
            },
          });
          applyBrandUserAgent(authWin.webContents);

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              try { authWin.close(); } catch { /* ignore */ }
              resolve({ success: false, error: 'Authentication timed out' });
            }
          }, timeoutMs);

          const handleRedirect = (_event: Electron.Event, redirectUrl: string) => {
            if (settled || !redirectUrl.includes(callbackMatch)) return;
            settled = true;
            clearTimeout(timeout);

            try {
              const parsed = new URL(redirectUrl);
              const params: Record<string, string> = {};
              parsed.searchParams.forEach((value, key) => {
                if (!extractParams || extractParams.includes(key)) {
                  params[key] = value;
                }
              });

              const successHtml = successMessage || `
                <html>
                <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
                  <div style="text-align: center;">
                    <h2 style="color: #4ade80;">&#10003; Authentication Successful</h2>
                    <p>You can close this window and return to the application.</p>
                  </div>
                </body>
                </html>
              `;
              authWin.loadURL(`data:text/html,${encodeURIComponent(successHtml)}`);
              setTimeout(() => {
                try { authWin.close(); } catch { /* ignore */ }
              }, 2000);

              resolve({ success: true, params });
            } catch (err) {
              try { authWin.close(); } catch { /* ignore */ }
              resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
            }
          };

          authWin.webContents.on('will-redirect', handleRedirect);
          authWin.webContents.on('will-navigate', handleRedirect);

          authWin.loadURL(url).catch((err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              try { authWin.close(); } catch { /* ignore */ }
              resolve({ success: false, error: `Failed to load auth URL: ${err.message}` });
            }
          });

          authWin.once('close', () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve({ success: false, error: 'Auth window closed by user' });
            }
          });
        });
      },
    },

    http: {
      listen: (port, handler) => {
        requirePermission('http:listen');
        return new Promise<void>((resolve, reject) => {
          if (httpServer) {
            reject(new Error('HTTP server already running for this plugin'));
            return;
          }

          httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const parsedUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
              const query: Record<string, string> = {};
              parsedUrl.searchParams.forEach((value, key) => {
                query[key] = value;
              });

              const headers: Record<string, string> = {};
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === 'string') headers[key] = value;
              }

              let body = '';
              if (req.method !== 'GET' && req.method !== 'HEAD') {
                body = await new Promise<string>((resolveBody) => {
                  const chunks: Buffer[] = [];
                  req.on('data', (chunk: Buffer) => chunks.push(chunk));
                  req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf-8')));
                });
              }

              const pluginReq: PluginHttpRequest = {
                method: req.method ?? 'GET',
                url: parsedUrl.pathname,
                headers,
                query,
                body: body || undefined,
              };

              const pluginRes: PluginHttpResponse = await handler(pluginReq);

              res.writeHead(pluginRes.status ?? 200, {
                'Content-Type': 'text/html',
                ...pluginRes.headers,
              });
              res.end(pluginRes.body ?? '');
            } catch (err) {
              console.error(`[Plugin:${manifest.name}] HTTP handler error:`, err);
              res.writeHead(500);
              res.end('Internal plugin error');
            }
          });

          httpServer.listen(port, '127.0.0.1', () => {
            console.info(`[Plugin:${manifest.name}] HTTP server listening on 127.0.0.1:${port}`);
            resolve();
          });

          httpServer.on('error', reject);
        });
      },

      close: () => {
        requirePermission('http:listen');
        return new Promise<void>((resolve) => {
          if (!httpServer) {
            resolve();
            return;
          }
          httpServer.close(() => {
            httpServer = null;
            resolve();
          });
        });
      },
    },

    agent: {
      registerBackend: (definition) => {
        requirePermission('agent:backend');
        const fullDefinition = {
          ...definition,
          pluginName: manifest.name,
        };
        registerAgentBackend(fullDefinition);
        if (!instance.registeredBackendKeys.includes(definition.key)) {
          instance.registeredBackendKeys.push(definition.key);
        }
      },
      unregisterBackend: (key: string) => {
        requirePermission('agent:backend');
        instance.registeredBackendKeys = instance.registeredBackendKeys.filter((backendKey) => backendKey !== key);
        unregisterAgentBackend(key);
      },
    },

    onAction: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => {
      callbacks.registerActionHandler(targetId, handler);
    },

    fetch: ((...args: Parameters<typeof globalThis.fetch>) => {
      requirePermission('network:fetch');
      return globalThis.fetch(...args);
    }) as typeof globalThis.fetch,
  };

  api.conversations.list = () => {
    requirePermission('conversations:read');
    const store = readConversationStore(callbacks.appHome);
    return Object.values(store.conversations) as PluginConversationRecord[];
  };

  api.conversations.get = (conversationId: string) => {
    requirePermission('conversations:read');
    const store = readConversationStore(callbacks.appHome);
    return (store.conversations[conversationId] as PluginConversationRecord | undefined) ?? null;
  };

  api.conversations.upsert = (conversation: PluginConversationRecord) => {
    requirePermission('conversations:write');
    const store = readConversationStore(callbacks.appHome);
    const normalizedConversation = normalizeConversationRecord(conversation);
    store.conversations[conversation.id] = normalizedConversation as unknown as typeof store.conversations[string];
    writeConversationStore(callbacks.appHome, store);
    broadcastConversationChange(store);
  };

  api.conversations.getActiveId = () => {
    requirePermission('conversations:read');
    return readConversationStore(callbacks.appHome).activeConversationId;
  };

  api.conversations.setActive = (conversationId: string) => {
    requirePermission('conversations:write');
    const store = readConversationStore(callbacks.appHome);
    store.activeConversationId = conversationId;
    writeConversationStore(callbacks.appHome, store);
    broadcastConversationChange(store);
    callbacks.openNavigationTarget({ type: 'conversation', conversationId });
  };

  api.conversations.appendMessage = (conversationId: string, message: PluginConversationAppendMessage) => {
    requirePermission('conversations:write');
    const conversation = api.conversations.get(conversationId);
    if (!conversation) return null;

    const next = normalizePluginObject(conversation) as PluginConversationRecord;
    const { tree, headId } = ensureConversationTree(next);
    const messageId = `plugin-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const normalizedContent = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content;
    const createdAt = message.createdAt ?? new Date().toISOString();
    const normalizedRole = normalizeConversationRole(message.role);

    const storedMessage: StoredConversationMessage = {
      id: messageId,
      role: normalizedRole,
      content: normalizedContent,
      parentId: message.parentId ?? headId,
      createdAt,
      metadata: message.metadata ? { ...message.metadata } : undefined,
    };

    const nextTree = [...tree, storedMessage];
    const nextHeadId = storedMessage.id;
    const nextBranch = getConversationBranch(nextTree, nextHeadId);

    next.messages = nextBranch;
    next.messageTree = nextTree;
    next.headId = nextHeadId;
    next.updatedAt = createdAt;
    next.lastMessageAt = createdAt;
    next.lastAssistantUpdateAt = normalizedRole === 'user' ? next.lastAssistantUpdateAt : createdAt;
    next.messageCount = nextBranch.length;
    next.userMessageCount = nextBranch.filter((entry) => entry.role === 'user').length;
    next.hasUnread = normalizedRole === 'user' ? next.hasUnread : true;
    api.conversations.upsert(next);
    return next;
  };

  api.conversations.markUnread = (conversationId: string, unread: boolean) => {
    requirePermission('conversations:write');
    const conversation = api.conversations.get(conversationId);
    if (!conversation) return;
    api.conversations.upsert({
      ...conversation,
      hasUnread: unread,
      updatedAt: new Date().toISOString(),
    });
  };

  return api;
}

/** Cleanup HTTP server when plugin is deactivated */
export async function cleanupPluginAPI(api: PluginAPI): Promise<void> {
  try {
    await api.http.close();
  } catch {
    // Ignore cleanup errors
  }
}
