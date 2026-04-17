import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const FIREBASE_PROJECT_ID = 'cleo-app-840c8';

const client = jwksClient({
  jwksUri: 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  cache: true,
  rateLimit: true,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(token, getKey, {
        algorithms: ['RS256'],
        audience: FIREBASE_PROJECT_ID,
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      }, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as jwt.JwtPayload);
      });
    });
    (req as AuthenticatedRequest).uid = decoded.sub;
    (req as AuthenticatedRequest).email = typeof decoded.email === 'string' ? decoded.email : undefined;
    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export interface AuthenticatedRequest extends Request {
  uid?: string;
  email?: string;
}

/**
 * Gate a route to a small allowlist of curator emails. Comma-separated
 * list in CURATOR_EMAILS env var. Empty/unset means no one is a curator.
 * Run after requireAuth so req.email is populated.
 */
export function requireCurator(req: Request, res: Response, next: NextFunction) {
  const allowlist = (process.env.CURATOR_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const email = (req as AuthenticatedRequest).email?.toLowerCase();
  if (!email || !allowlist.includes(email)) {
    res.status(403).json({ error: 'curator access required' });
    return;
  }
  next();
}
