/**
 * Unit tests — uploadImageFromUrl's content-type -> file extension mapping.
 * Covers: video content types (mp4/webm/quicktime) no longer default to .jpg —
 * a video ad's file was silently getting a .jpg extension on S3 despite a
 * correct Content-Type, since only png/webp were ever recognized.
 */
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
process.env.AWS_S3_BUCKET = 'test-bucket';

const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: (...args: any[]) => send(...args) })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn(),
}));

import { uploadImageFromUrl } from '../lib/s3';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({});
});

function fetchOk(contentType: string) {
  return {
    ok: true,
    headers: { get: (h: string) => (h === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(4),
  };
}

test.each([
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
  ['image/jpeg', 'jpg'],
  ['application/octet-stream', 'jpg'],
])('content-type %s maps to .%s', async (contentType, expectedExt) => {
  mockFetch.mockResolvedValue(fetchOk(contentType));

  const url = await uploadImageFromUrl('https://cdn.example.com/file', 'competitor-ads');

  expect(url).toContain(`.${expectedExt}`);
  const putInput = send.mock.calls[0][0].input;
  expect(putInput.Key.endsWith(`.${expectedExt}`)).toBe(true);
  expect(putInput.ContentType).toBe(contentType);
});

test('an HTML redirect stub (e.g. Facebook lookaside crawler URLs) is rejected, not re-hosted as media', async () => {
  mockFetch.mockResolvedValue(fetchOk('text/html; charset="utf-8"'));

  const url = await uploadImageFromUrl('https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1', 'business-profile');

  expect(url).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
