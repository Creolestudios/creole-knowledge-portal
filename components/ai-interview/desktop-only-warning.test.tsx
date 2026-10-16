// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DesktopOnlyWarning } from './desktop-only-warning';

describe('DesktopOnlyWarning component', () => {
  it('renders the laptop or desktop required warning text', () => {
    render(<DesktopOnlyWarning />);

    expect(screen.getByText('Desktop Device Required')).toBeInTheDocument();
    expect(screen.getByText('Laptop or Desktop Required')).toBeInTheDocument();
    expect(screen.getByText(/You are trying to access this interview from a mobile phone or tablet/i)).toBeInTheDocument();
    expect(screen.getByText(/Why is a computer required\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy interview link/i })).toBeInTheDocument();
  });

  it('renders a custom message when passed as a prop', () => {
    render(<DesktopOnlyWarning customMessage="Custom laptop restriction notice" />);

    expect(screen.getByText('Custom laptop restriction notice')).toBeInTheDocument();
  });

  it('copies the link when copy button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DesktopOnlyWarning />);
    const copyButton = screen.getByRole('button', { name: /copy interview link/i });
    fireEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalled();
    expect(await screen.findByText('Interview Link Copied!')).toBeInTheDocument();
  });
});
