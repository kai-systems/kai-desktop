import type { IpcMain, IpcMainInvokeEvent } from 'electron';

type HandlerFn = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

/** Captured IPC handlers keyed by channel name. */
const handlers = new Map<string, HandlerFn>();

/** Channels that rely on Electron APIs unavailable in web mode. */
const UNSUPPORTED_CHANNELS = new Set([
  'dialog:open-file',
  'dialog:open-directory',
  'dialog:open-directory-files',
  'image:fetch',
  'image:save',
]);

/**
 * Monkey-patches `ipcMain.handle` so that every handler registered after this
 * call is also stored in an internal map.  Must be called **before** any
 * `registerXxxHandlers()` calls.
 */
export function installIpcCapture(ipcMain: IpcMain): void {
  const originalHandle = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel: string, listener: HandlerFn) => {
    handlers.set(channel, listener);
    return originalHandle(channel, listener);
  };
}

/**
 * Invoke a previously-captured IPC handler from outside the Electron IPC
 * transport (i.e. from the WebSocket bridge).
 *
 * Returns the handler's return value, or throws if the channel is unknown or
 * unsupported in web mode.
 */
export async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  if (UNSUPPORTED_CHANNELS.has(channel)) {
    throw new Error(`Channel "${channel}" is not supported in web mode`);
  }

  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel "${channel}"`);
  }

  // Build a minimal fake event — handlers rarely use `event` beyond `event.sender`
  const fakeEvent = { sender: null } as unknown as IpcMainInvokeEvent;
  return handler(fakeEvent, ...args);
}
