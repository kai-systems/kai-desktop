import { useState, type FC } from 'react';
import { Toggle, NumberField, TextField, settingsSelectClass, type SettingsProps } from './shared';
import { WebServerQRCode } from './WebServerQRCode';

type WebServerConfig = {
  enabled: boolean;
  port: number;
  tls: {
    enabled: boolean;
    mode: 'self-signed' | 'custom';
    certPath: string;
    keyPath: string;
  };
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
    tls: { enabled: true, mode: 'self-signed' as const, certPath: '', keyPath: '' },
    auth: { mode: 'anonymous' as const, username: '', password: '' },
  };

  const [showQR, setShowQR] = useState(false);
  const protocol = ws.tls.enabled ? 'https' : 'http';

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Web UI</h3>
      <p className="text-xs text-muted-foreground">
        Serve the same chat interface over HTTP/HTTPS so you can access it from any browser on your network.
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
              Access the Web UI at <span className="font-mono">{protocol}://localhost:{ws.port}</span>
            </p>
          </fieldset>

          <fieldset className="rounded-lg border p-3 space-y-3">
            <legend className="text-xs font-semibold px-1">TLS / HTTPS</legend>
            <Toggle
              label="Enable HTTPS"
              checked={ws.tls.enabled}
              onChange={(v) => updateConfig('webServer.tls.enabled', v)}
            />
            <p className="text-[10px] text-muted-foreground">
              HTTPS is required for microphone access (dictation, realtime calls) when connecting from other devices.
            </p>

            {ws.tls.enabled && (
              <div className="space-y-3 pl-1">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Certificate Mode</label>
                  <select
                    className={settingsSelectClass}
                    value={ws.tls.mode}
                    onChange={(e) => updateConfig('webServer.tls.mode', e.target.value)}
                  >
                    <option value="self-signed">Self-Signed (auto-generated)</option>
                    <option value="custom">Custom Certificate</option>
                  </select>
                </div>

                {ws.tls.mode === 'self-signed' && (
                  <p className="text-[10px] text-muted-foreground">
                    A self-signed certificate will be generated automatically for localhost and all local network IPs.
                    Your browser will show a security warning on first visit — accept it to proceed.
                  </p>
                )}

                {ws.tls.mode === 'custom' && (
                  <div className="space-y-3">
                    <TextField
                      label="Certificate file path"
                      value={ws.tls.certPath}
                      onChange={(v) => updateConfig('webServer.tls.certPath', v)}
                      placeholder="/path/to/cert.pem"
                      mono
                    />
                    <TextField
                      label="Private key file path"
                      value={ws.tls.keyPath}
                      onChange={(v) => updateConfig('webServer.tls.keyPath', v)}
                      placeholder="/path/to/key.pem"
                      mono
                    />
                  </div>
                )}
              </div>
            )}
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

          <fieldset className="rounded-lg border p-3 space-y-3">
            <legend className="text-xs font-semibold px-1">Remote Access</legend>
            <p className="text-[10px] text-muted-foreground">
              Scan the QR code from a phone or tablet to open the web UI with auto-login.
            </p>

            <button
              className="w-full rounded-xl border border-border/60 bg-card/60 px-3 py-2 text-xs hover:bg-card transition-colors"
              onClick={() => setShowQR(true)}
            >
              Show QR Code
            </button>
          </fieldset>
        </>
      )}

      {showQR && <WebServerQRCode config={ws} onClose={() => setShowQR(false)} />}
    </div>
  );
};
