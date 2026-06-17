import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'otx-dev-secret-change-in-prod';
const EXPIRES_IN = 60 * 60 * 24; // 24 hours

export interface ApprovalTokenPayload {
  actionId: string;
  businessProfileId: string;
}

export function signApprovalToken(payload: ApprovalTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyApprovalToken(token: string): ApprovalTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as ApprovalTokenPayload & jwt.JwtPayload;
  if (!decoded.actionId || !decoded.businessProfileId) {
    throw new Error('Invalid token payload');
  }
  return { actionId: decoded.actionId, businessProfileId: decoded.businessProfileId };
}
