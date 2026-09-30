import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../shared/config';
import { UnauthorizedError, ValidationError } from '../../shared/errors';
import { DatabaseConnection } from '../../infrastructure/database/DatabaseConnection';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const DEMO_USERS = [
  {
    id: 'user-admin',
    username: 'admin',
    passwordHash: crypto.createHash('sha256').update('nexusflow-admin').digest('hex'),
    role: 'admin',
  },
  {
    id: 'user-viewer',
    username: 'viewer',
    passwordHash: crypto.createHash('sha256').update('nexusflow-viewer').digest('hex'),
    role: 'viewer',
  },
];

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * AuthController — JWT login, refresh, and logout endpoints.
 * Uses token rotation: each refresh issues a new refresh token and
 * invalidates the previous one.
 */
export class AuthController {
  public readonly router: Router;
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.router = Router();
    this.seedDemoUsers();
    this.registerRoutes();
  }

  private seedDemoUsers(): void {
    for (const user of DEMO_USERS) {
      const existing = this.db.db
        .prepare(`SELECT id FROM users WHERE id = ?`)
        .get(user.id);
      if (!existing) {
        this.db.db
          .prepare(
            `INSERT INTO users (id, username, password_hash, role, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(user.id, user.username, user.passwordHash, user.role, new Date().toISOString());
      }
    }
  }

  private registerRoutes(): void {
    this.router.post('/login', this.login.bind(this));
    this.router.post('/refresh', this.refresh.bind(this));
    this.router.post('/logout', this.logout.bind(this));
  }

  private login(req: Request, res: Response, next: NextFunction): void {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid credentials format');

      const { username, password } = parsed.data;
      const passwordHash = hashPassword(password);

      const user = this.db.db
        .prepare(`SELECT * FROM users WHERE username = ? AND password_hash = ?`)
        .get(username, passwordHash) as
        | { id: string; username: string; role: string }
        | undefined;

      if (!user) throw new UnauthorizedError('Invalid username or password');

      const signOptions: SignOptions = { expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
      const accessToken = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        config.JWT_SECRET,
        signOptions
      );

      const refreshToken = uuidv4();
      const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      this.db.db
        .prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(uuidv4(), user.id, refreshHash, expiresAt);

      res.json({ accessToken, refreshToken, expiresIn: config.JWT_EXPIRES_IN });
    } catch (err) {
      next(err);
    }
  }

  private refresh(req: Request, res: Response, next: NextFunction): void {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken) throw new UnauthorizedError('Missing refresh token');

      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const record = this.db.db
        .prepare(
          `SELECT rt.*, u.username, u.role FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           WHERE rt.token_hash = ? AND rt.revoked = 0 AND rt.expires_at > ?`
        )
        .get(tokenHash, new Date().toISOString()) as
        | { id: string; user_id: string; username: string; role: string }
        | undefined;

      if (!record) throw new UnauthorizedError('Invalid or expired refresh token');

      // Rotate: revoke old token
      this.db.db
        .prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`)
        .run(record.id);

      const refreshSignOptions: SignOptions = { expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
      const accessToken = jwt.sign(
        { userId: record.user_id, username: record.username, role: record.role },
        config.JWT_SECRET,
        refreshSignOptions
      );

      const newRefreshToken = uuidv4();
      const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      this.db.db
        .prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(uuidv4(), record.user_id, newHash, expiresAt);

      res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (err) {
      next(err);
    }
  }

  private logout(req: Request, res: Response, next: NextFunction): void {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (refreshToken) {
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        this.db.db
          .prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`)
          .run(tokenHash);
      }
      res.json({ message: 'Logged out' });
    } catch (err) {
      next(err);
    }
  }
}
