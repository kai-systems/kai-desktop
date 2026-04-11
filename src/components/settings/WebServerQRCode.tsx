import { useState, useEffect, type FC } from 'react';
import { QRCodeSVG } from 'qrcode.react';

declare const window: Window & {
  app?: {
    webServer?: { getLanAddresses: () => Promise<string[]> };
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

function buildConnectUrl(host: string, config: WebServerConfig): string {
  const params = new URLSearchParams();
  params.set('host', host);
  // When TLS is self-signed, mobile uses the plain HTTP fallback on port+1
  const mobilePort = (config.tls.enabled && config.tls.mode === 'self-signed')
    ? config.port + 1
    : config.port;
  params.set('port', String(mobilePort));
  params.set('auth', config.auth.mode);
  if (config.auth.mode === 'password') {
    params.set('user', config.auth.username);
    params.set('pass', config.auth.password);
  }
  // Tell mobile whether to use TLS — plain HTTP for self-signed fallback port
  const mobileTls = config.tls.enabled && config.tls.mode !== 'self-signed';
  params.set('tls', mobileTls ? '1' : '0');
  if (config.tls.enabled && config.tls.mode === 'self-signed') {
    params.set('selfsigned', '1');
  }
  try {
    const os = require('os');
    params.set('name', os.hostname());
  } catch {
    // In web mode, hostname isn't available
  }
  return `kai://connect?${params.toString()}`;
}

export const WebServerQRCode: FC<Props> = ({ config, onClose }) => {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<string>('');

  useEffect(() => {
    if (window.app?.webServer?.getLanAddresses) {
      window.app.webServer.getLanAddresses().then((addrs) => {
        setAddresses(addrs);
        if (addrs.length > 0) setSelectedAddr(addrs[0]);
      });
    }
  }, []);

  const connectUrl = selectedAddr ? buildConnectUrl(selectedAddr, config) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="rounded-2xl border border-border bg-card p-6 shadow-xl max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Connect Kai Mobile</h3>
          <button
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            onClick={onClose}
          >
            {'\u2715'}
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground mb-4">
          Scan this QR code with the Kai Mobile app to connect instantly.
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
          <p className="text-[10px] text-muted-foreground font-mono">
            {selectedAddr}:{(config.tls.enabled && config.tls.mode === 'self-signed') ? config.port + 1 : config.port}
          </p>
          {config.auth.mode === 'password' && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Authentication: Password
            </p>
          )}
          {config.tls.enabled && config.tls.mode === 'self-signed' && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Mobile uses plain HTTP on port {config.port + 1} (self-signed TLS fallback)
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
