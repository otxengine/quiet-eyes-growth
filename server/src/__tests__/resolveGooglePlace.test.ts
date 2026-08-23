import { Request } from 'express';
import { resolveGooglePlace } from '../routes/functions/resolveGooglePlace';
import { prisma } from '../db';
import { findPlaceId } from '../lib/googlePlaces';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: { findUnique: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../lib/googlePlaces', () => ({ findPlaceId: jest.fn() }));

const bpFindUnique = prisma.businessProfile.findUnique as jest.Mock;
const bpUpdate     = prisma.businessProfile.update     as jest.Mock;
const mockFindPlaceId = findPlaceId as jest.Mock;

function makeReqRes(body: any) {
  const json = jest.fn().mockReturnThis();
  const req  = { body } as unknown as Request;
  const res: any = { status: jest.fn().mockReturnThis(), json };
  return { req, res, json };
}

beforeEach(() => jest.clearAllMocks());

test('400 when businessProfileId missing', async () => {
  const { req, res } = makeReqRes({});
  await resolveGooglePlace(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
});

test('404 when profile not found', async () => {
  bpFindUnique.mockResolvedValue(null);
  const { req, res } = makeReqRes({ businessProfileId: 'bp1' });
  await resolveGooglePlace(req, res);
  expect(res.status).toHaveBeenCalledWith(404);
});

test('already has google_place_id — returns it without searching', async () => {
  bpFindUnique.mockResolvedValue({ id: 'bp1', name: 'Test Biz', city: 'תל אביב', google_place_id: 'existing123' });
  const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
  await resolveGooglePlace(req, res);
  expect(mockFindPlaceId).not.toHaveBeenCalled();
  expect(bpUpdate).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith({ google_place_id: 'existing123', already_set: true });
});

test('no google_place_id — resolves and persists via findPlaceId', async () => {
  bpFindUnique.mockResolvedValue({ id: 'bp1', name: 'Test Biz', city: 'תל אביב', google_place_id: null });
  mockFindPlaceId.mockResolvedValue('ChIJresolved');
  const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
  await resolveGooglePlace(req, res);
  expect(mockFindPlaceId).toHaveBeenCalledWith('Test Biz', 'תל אביב');
  expect(bpUpdate).toHaveBeenCalledWith({
    where: { id: 'bp1' },
    data:  { google_place_id: 'ChIJresolved', google_place_id_verified: true },
  });
  expect(json).toHaveBeenCalledWith({ google_place_id: 'ChIJresolved', already_set: false });
});

test('no match found — leaves profile untouched', async () => {
  bpFindUnique.mockResolvedValue({ id: 'bp1', name: 'Test Biz', city: 'תל אביב', google_place_id: null });
  mockFindPlaceId.mockResolvedValue(null);
  const { req, res, json } = makeReqRes({ businessProfileId: 'bp1' });
  await resolveGooglePlace(req, res);
  expect(bpUpdate).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith({ google_place_id: null, already_set: false });
});
