import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { userDb } from "./database";

const rawJwtSecret = process.env.JWT_SECRET;

// if (!rawJwtSecret || rawJwtSecret.trim().length < 32) {
//   throw new Error(
//     "JWT_SECRET environment variable must be set to a strong, random secret (at least 32 characters)."
//   );
// }
const JWT_SECRET: string = rawJwtSecret ?? "default-secret";
const JWT_EXPIRES_IN = "7d";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: number, username: string, email: string): string {
  return jwt.sign({ id: userId, username, email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string): { id: number; username: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const payload = decoded as jwt.JwtPayload & {
      id?: number;
      username?: string;
      email?: string;
    };

    if (
      typeof payload.id !== "number" ||
      typeof payload.username !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }

    return {
      id: payload.id,
      username: payload.username,
      email: payload.email,
    };
  } catch (err) {
    return null;
  }
}

// Middleware to protect routes
export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  // Verify user still exists
  const user = userDb.findById(payload.id);
  if (!user) {
    return res.status(403).json({ error: "User not found" });
  }

  req.user = {
    id: payload.id,
    username: payload.username,
    email: payload.email,
  };

  next();
}

// Optional auth middleware - adds user info if token present but doesn't require it
export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = userDb.findById(payload.id);
      if (user) {
        req.user = {
          id: payload.id,
          username: payload.username,
          email: payload.email,
        };
      }
    }
  }

  next();
}
