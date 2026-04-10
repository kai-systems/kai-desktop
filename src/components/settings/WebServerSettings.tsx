import type { FC } from 'react';
import { Toggle, NumberField, TextField, settingsSelectClass, type SettingsProps } from './shared';

type WebServerConfig = {
  enabled: boolean;
  port: number;
  auth: {
    mode: 'anonymous' | 'password';
    username: string;
    password: string;
  };
};

export const WebServerSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const ws = (config.webServer as WebServerConfig | undefined) ?? {
    enabled: false,
    port: 5243,
    auth: { mode: 'anonymous' as const, username: '', password: '' },
  };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Web UI</h3>
      <p className="text-xs text-muted-foreground">
        Serve the same chat interface over HTTP so you can access it from any browser on your network.
      </p>

      <Toggle
        label="Enable Web UI server"
        checked={ws.enabled}
        onChange={(v) => updateConfig('webServer.enabled', v)}
      />

      {ws.enabled && (
        <>
          <fieldset className="rounded-lg border p-3 space-y-3">
            <legend className="text-xs font-semibold px-1">Server</legend>
            <NumberField
              label="Port"
              value={ws.port}
              onChange={(v) => {
                if (v >= 1 && v <= 65535) updateConfig('webServer.port', v);
              }}
              min={1}
              max={65535}
            />
            <p className="text-[10px] text-muted-foreground">
              Access the Web UI at <span className="font-mono">http://localhost:{ws.port}</span>
            </p>
          </fieldset>

          <fieldset className="rounded-lg border p-3 space-y-3">
            <legend className="text-xs font-semibold px-1">Authentication</legend>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Access Mode</label>
              <select
                className={settingsSelectClass}
                value={ws.auth.mode}
                onChange={(e) => updateConfig('webServer.auth.mode', e.target.value)}
              >
                <option value="anonymous">Anonymous (no login required)</option>
                <option value="password">Password Protected</option>
              </select>
            </div>

            {ws.auth.mode === 'password' && (
              <div className="space-y-3 pl-1">
                <TextField
                  label="Username"
                  value={ws.auth.username}
                  onChange={(v) => updateConfig('webServer.auth.username', v)}
                  placeholder="admin"
                />
                <TextField
                  label="Password"
                  value={ws.auth.password}
                  onChange={(v) => updateConfig('webServer.auth.password', v)}
                  placeholder="Enter password"
                  mono
                />
              </div>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
};
