import { networkInterfaces } from 'os';

/**
 * Get the LAN IPv4 address(es) of this machine.
 * Filters out loopback (127.x) and internal interfaces.
 */
export function getLanAddresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}
