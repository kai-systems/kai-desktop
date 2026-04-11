import { Bonjour, type Service } from 'bonjour-service';
import { hostname } from 'os';

let service: Service | null = null;
let bonjour: InstanceType<typeof Bonjour> | null = null;

/**
 * Publish an mDNS/Bonjour service so Kai Mobile can discover this instance.
 * Service type: _kai._tcp
 */
export function publishMdns(port: number, authMode: string, appVersion: string): void {
  unpublishMdns();

  try {
    bonjour = new Bonjour();
    service = bonjour.publish({
      name: `Kai Desktop (${hostname()})`,
      type: 'kai',
      port,
      txt: {
        auth: authMode,
        version: appVersion,
      },
    });
  } catch (err) {
    console.error('[mDNS] Failed to publish service:', err);
  }
}

/**
 * Unpublish the mDNS service and clean up.
 */
export function unpublishMdns(): void {
  if (service) {
    try {
      service.stop(() => {});
    } catch {
      // Ignore stop errors
    }
    service = null;
  }
  if (bonjour) {
    try {
      bonjour.destroy();
    } catch {
      // Ignore destroy errors
    }
    bonjour = null;
  }
}
