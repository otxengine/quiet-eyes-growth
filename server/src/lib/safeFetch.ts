import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * fetch() for URLs that come from users or scraped pages (business and competitor
 * websites, image and video URLs). Only public http(s) addresses: never loopback,
 * private, link-local (cloud metadata 169.254.169.254, ECS credentials 169.254.170.2)
 * or other reserved ranges, and every redirect hop is checked again.
 *
 * ponytail: the address is checked, then fetch() resolves the name again, so a DNS
 * rebinding attacker (two answers, TTL 0) can still slip in. Upgrade path: pin the
 * checked IP with an undici Agent ({ connect: { lookup } }) if internal HTTP services appear.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, bits, 'ipv6');

export class BlockedUrlError extends Error {}

export function isBlockedAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

async function assertPublicUrl(url: string): Promise<void> {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') throw new BlockedUrlError(`Blocked protocol: ${protocol}`);
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map(a => a.address);
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new BlockedUrlError(`Blocked address for ${host}`);
}

export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    current = new URL(location, current).toString();
  }
  throw new BlockedUrlError('Too many redirects');
}
