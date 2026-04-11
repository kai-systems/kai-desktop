import { useState, useEffect, type FC } from 'react';
import { QRCodeSVG } from 'qrcode.react';

declare const window: Window & {
  app?: {
    webServer?: {
      getLanAddresses: () => Promise<string[]>;
      createToken: () => Promise<string | null>;
    };
  };
};

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

type Props = {
  config: WebServerConfig;
  onClose: () => void;
};

function buildConnectUrl(host: string, config: WebServerConfig, token: string | null): string {
  const protocol = config.tls.enabled ? 'https' : 'http';
  const base = `${protocol}://${host}:${config.port}`;
  if (config.auth.mode === 'anonymous' || !token) {
    return base;
  }
  return `${base}/api/token-login?token=${encodeURIComponent(token)}`;
}

export const WebServerQRCode: FC<Props> = ({ config, onClose }) => {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<string>('');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (window.app?.webServer?.getLanAddresses) {
      window.app.webServer.getLanAddresses().then((addrs) => {
        setAddresses(addrs);
        if (addrs.length > 0) setSelectedAddr(addrs[0]);
      });
    }
  }, []);

  useEffect(() => {
    if (config.auth.mode === 'password' && window.app?.webServer?.createToken) {
      window.app.webServer.createToken().then(setToken);
    }
  }, [config.auth.mode]);

  const regenerateToken = () => {
    if (window.app?.webServer?.createToken) {
      window.app.webServer.createToken().then(setToken);
    }
  };

  const connectUrl = selectedAddr ? buildConnectUrl(selectedAddr, config, token) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="rounded-2xl border border-border bg-card p-6 shadow-xl max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Web UI QR Code</h3>
          <button
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            onClick={onClose}
          >
            {'\u2715'}
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground mb-4">
          Scan this QR code with your phone or tablet camera to open the web UI.
        </p>

        {addresses.length > 1 && (
          <div className="mb-3">
            <label className="text-[10px] text-muted-foreground block mb-0.5">Network Address</label>
            <select
              className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              value={selectedAddr}
              onChange={(e) => setSelectedAddr(e.target.value)}
            >
              {addresses.map((addr) => (
                <option key={addr} value={addr}>{addr}</option>
              ))}
            </select>
          </div>
        )}

        {connectUrl ? (
          <div className="flex justify-center py-4">
            <div className="bg-white p-3 rounded-xl">
              <QRCodeSVG
                value={connectUrl}
                size={200}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-8">
            <p className="text-xs text-muted-foreground">No network address found</p>
          </div>
        )}

        <div className="mt-3 text-center">
          <p className="text-[10px] text-muted-foreground font-mono break-all">
            {connectUrl}
          </p>
          {config.auth.mode === 'password' && (
            <>
              <p className="text-[10px] text-muted-foreground mt-1">
                Token expires in 5 minutes (single use)
              </p>
              <button
                className="text-[10px] text-muted-foreground underline mt-1 hover:text-foreground transition-colors"
                onClick={regenerateToken}
              >
                Regenerate token
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
