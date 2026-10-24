import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * fetch() for URLs that come from users or scraped pages (business and competitor
 * websites, image and video URLs). Only public http(s) addresses: never loopback,
 * private, link-local (cloud metadata 169.254.169.254, ECS credentials 169.254.170.2)
 * or other reserved ranges, and every redirect hop is checked again. Connections are
 * pinned to the address that was checked, so DNS rebinding can't swap it afterwards.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  // ::/96 IPv4-compatible (::7f00:1), ::ffff:0:0:0/96 IPv4-translated, 6to4, NAT64, site-local
  ['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, bits, 'ipv6');

export class BlockedUrlError extends Error {}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

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

// The socket's own DNS lookup: resolve once at connect time, refuse if any answer is
// internal, and connect to exactly that answer. Without it fetch() resolves the name again
// after assertPublicUrl, so a DNS-rebinding domain (TTL 0) could answer a public address to
// the check and an internal one to the connection. IP-literal hosts never reach a lookup;
// assertPublicUrl covers those.
function checkedLookup(hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) {
  lookup(hostname, { all: true, verbatim: true }).then(addresses => {
    if (!addresses.length || addresses.some(a => isBlockedAddress(a.address))) {
      return callback(new BlockedUrlError(`Blocked address for ${hostname}`));
    }
    if (options?.all) callback(null, addresses); // net asks for all when autoSelectFamily is on
    else callback(null, addresses[0].address, addresses[0].family);
  }, callback);
}
const pinnedAgent = new Agent({ connect: { lookup: checkedLookup as any } });

export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual', dispatcher: pinnedAgent } as RequestInit);
    const location = REDIRECTS.has(res.status) ? res.headers.get('location') : null;
    if (!location) return res;
    await res.body?.cancel(); // free the connection of the hop we don't read
    // Header values arrive as latin1; a raw UTF-8 path like /אודות must be decoded back.
    current = new URL(Buffer.from(location, 'latin1').toString('utf8'), current).toString();
  }
  throw new BlockedUrlError('Too many redirects');
}
