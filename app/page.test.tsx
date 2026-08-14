// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const mockSignInWithOtp = vi.fn();
const mockSignInWithOAuth = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: {
      signInWithOtp: (...args: any[]) => mockSignInWithOtp(...args),
      signInWithOAuth: (...args: any[]) => mockSignInWithOAuth(...args),
    },
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('renders the sign-in form once mounted', async () => {
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
  });

  it('shows a decoded error message from the URL query string', async () => {
    window.history.pushState({}, '', '/?error=Something%20went%20wrong');
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  it('shows a friendlier message for an expired OTP link', async () => {
    window.history.pushState({}, '', '/?error=Link%20expired&error_code=otp_expired');
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText(/Verification link expired or already used/)).toBeInTheDocument();
    });
  });

  it('sends a magic link and shows the success state', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    render(<LoginPage />);
    await waitFor(() => screen.getByLabelText('Email Address'));

    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'dev@creolestudios.com' } });
    fireEvent.click(screen.getByText('Send Magic Link'));

    await waitFor(() => {
      expect(screen.getByText(/Check your inbox/)).toBeInTheDocument();
    });
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'dev@creolestudios.com' }),
    );
  });

  it('shows an error message when the magic-link request fails', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'Rate limited' } });
    render(<LoginPage />);
    await waitFor(() => screen.getByLabelText('Email Address'));

    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'dev@creolestudios.com' } });
    fireEvent.click(screen.getByText('Send Magic Link'));

    await waitFor(() => {
      expect(screen.getByText('Rate limited')).toBeInTheDocument();
    });
  });

  it('initiates Google OAuth login', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    render(<LoginPage />);
    await waitFor(() => screen.getByText('Continue with Google'));

    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' }),
      );
    });
  });

  it('shows an error message when Google OAuth fails to initialize', async () => {
    mockSignInWithOAuth.mockRejectedValue(new Error('OAuth misconfigured'));
    render(<LoginPage />);
    await waitFor(() => screen.getByText('Continue with Google'));

    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(screen.getByText('OAuth misconfigured')).toBeInTheDocument();
    });
  });
});
