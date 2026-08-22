import { describe, it, expect, afterEach } from 'vitest';
import {
  getAuthCallbackUrl,
  getBasePath,
  getPublicOrigin,
  withBasePath,
} from './auth-urls';

describe('auth-urls', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
  });

  it('returns empty base path when unset', () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    expect(getBasePath()).toBe('');
    expect(withBasePath('/dashboard')).toBe('/dashboard');
  });

  it('prefixes routes with NEXT_PUBLIC_BASE_PATH', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/creole-knowledge-portal';
    expect(withBasePath('/auth/callback')).toBe('/creole-knowledge-portal/auth/callback');
    expect(withBasePath('/')).toBe('/creole-knowledge-portal/');
  });

  it('builds auth callback URLs for production', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/creole-knowledge-portal';
    expect(getAuthCallbackUrl('https://ckp.nikcreations.com')).toBe(
      'https://ckp.nikcreations.com/creole-knowledge-portal/auth/callback',
    );
  });

  it('uses https for non-localhost origins', () => {
    expect(getPublicOrigin('ckp.nikcreations.com', 'http:', '8080')).toBe(
      'https://ckp.nikcreations.com',
    );
    expect(getPublicOrigin('localhost', 'http:', '3000')).toBe('http://localhost:3000');
  });
});
