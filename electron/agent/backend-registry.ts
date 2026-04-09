import type { AppConfig } from '../config/schema.js';
import type { ModelCatalogEntry, ResolvedStreamConfig, ReasoningEffort } from './model-catalog.js';
import type { StreamEvent } from './mastra-agent.js';
import type { ToolDefinition } from '../tools/types.js';

export type AgentBackendKey = string;

export type AgentBackendStreamOptions = {
  conversationId: string;
  messages: unknown[];
  modelKey?: string;
  profileKey?: string;
  fallbackEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  cwd?: string;
  config: AppConfig;
  appHome: string;
  primaryModel: ModelCatalogEntry | null;
  streamConfig: ResolvedStreamConfig | null;
  tools: ToolDefinition[];
  abortSignal?: AbortSignal;
  emitEvent?: (event: StreamEvent) => void;
  onToolExecutionStart?: (state: { toolCallId: string; toolName: string; args: unknown; cancel: () => void }) => void;
  onToolExecutionEnd?: (state: { toolCallId: string; toolName: string }) => void;
  augmentToolResult?: (state: { toolCallId: string; toolName: string; args: unknown; result: unknown }) => Promise<unknown> | unknown;
};

export type AgentBackendDefinition = {
  key: AgentBackendKey;
  displayName: string;
  pluginName?: string;
  isAvailable?: () => boolean;
  stream: (options: AgentBackendStreamOptions) => AsyncGenerator<StreamEvent>;
};

const registeredBackends = new Map<AgentBackendKey, AgentBackendDefinition>();

export function registerAgentBackend(definition: AgentBackendDefinition): void {
  registeredBackends.set(definition.key, definition);
}

export function unregisterAgentBackend(key: AgentBackendKey): void {
  registeredBackends.delete(key);
}

export function unregisterAgentBackendsForPlugin(pluginName: string): void {
  for (const [key, definition] of registeredBackends.entries()) {
    if (definition.pluginName === pluginName) {
      registeredBackends.delete(key);
    }
  }
}

export function getAgentBackend(key: AgentBackendKey | null | undefined): AgentBackendDefinition | null {
  if (!key) return null;
  return registeredBackends.get(key) ?? null;
}

export function listAgentBackends(): AgentBackendDefinition[] {
  return [...registeredBackends.values()];
}
