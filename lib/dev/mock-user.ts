/** Dev-only mock identity — never active when NODE_ENV=production. */
export const MOCK_USER = {
  id: 'b632b1ab-71e5-48ca-ab5d-b431c4e65004',
  email: 'priyadhanani125@gmail.com',
} as const;

export function isMockUserAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function mockUserFromCookie(cookieValue: string | undefined) {
  if (!isMockUserAllowed() || cookieValue !== 'true') {
    return null;
  }
  return MOCK_USER;
}
