/**
 * downloadFromS3 reads only our own media objects: a URL on our bucket host whose key is
 * `<media folder>/<uuid>.<ext>`. Other hosts, other keys and path tricks never reach S3.
 */
process.env.AWS_S3_BUCKET = 'test-bucket';
process.env.AWS_S3_REGION = 'us-east-1';
delete process.env.AWS_CDN_URL;

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: (...args: any[]) => send(...args) })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { downloadFromS3 } from '../lib/s3';

const HOST = 'https://test-bucket.s3.us-east-1.amazonaws.com';
const UUID = '0b8f3c1e-2d4a-4e5b-9c6d-7e8f9a0b1c2d';

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array([1, 2]) }, ContentType: 'image/png' });
});

test.each([
  `competitor-posts/${UUID}.jpg`,
  `business-media/${UUID}.mp4`,
  `logos/${UUID}.png`,
])('reads our media object %s', async (key) => {
  const obj = await downloadFromS3(`${HOST}/${key}`);
  expect(obj?.contentType).toBe('image/png');
  expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'test-bucket', Key: key });
});

test.each([
  ['another folder', `${HOST}/private/${UUID}.jpg`],
  ['a non-uuid name', `${HOST}/business-media/report.pdf`],
  ['a nested key', `${HOST}/business-media/x/${UUID}.jpg`],
  ['dot segments', `${HOST}/business-media/../secrets/${UUID}.jpg`],
  ['encoded dot segments', `${HOST}/business-media/%2e%2e/secrets/${UUID}.jpg`],
  ['an encoded slash', `${HOST}/business-media%2F${UUID}.jpg`],
  ['another bucket', `https://other-bucket.s3.us-east-1.amazonaws.com/business-media/${UUID}.jpg`],
  ['a foreign host', `https://example.com/business-media/${UUID}.jpg`],
  ['not a URL', 'business-media/x.jpg'],
])('refuses %s without calling S3', async (_label, url) => {
  expect(await downloadFromS3(url)).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
