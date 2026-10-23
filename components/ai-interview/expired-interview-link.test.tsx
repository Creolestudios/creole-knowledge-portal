/** @vitest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpiredInterviewLink } from './expired-interview-link';

describe('ExpiredInterviewLink component', () => {
  it('displays completed message when interview session was completed', () => {
    render(
      <ExpiredInterviewLink
        reason="completed"
        reasonTitle="Interview Completed"
        note="Note: This interview link has already been used and is expired."
      />
    );

    expect(screen.getByText(/✅ Interview Completed/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Interview Completed/i })).toBeInTheDocument();
    expect(
      screen.getByText('This link is expired it is one time use , your interview is completed we will get back to you soon')
    ).toBeInTheDocument();
  });

  it('displays terminated message and individual reason for tab switch violation', () => {
    render(
      <ExpiredInterviewLink
        reason="violation"
        violationReason="The candidate clicked outside the interview window or switched tabs."
      />
    );

    expect(screen.getByText(/Tab Switch & Focus Policy Violation/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Link is expired/i })).toBeInTheDocument();
    expect(screen.getByText('This link is expired it is one time use')).toBeInTheDocument();
    expect(
      screen.getByText('The candidate clicked outside the interview window or switched tabs.')
    ).toBeInTheDocument();
    expect(screen.getByText(/Reason for Termination/i)).toBeInTheDocument();
  });

  it('displays terminated message and individual reason for session refresh violation', () => {
    render(
      <ExpiredInterviewLink
        reason="violation"
        violationReason="The candidate refreshed or closed the page during the live interview."
      />
    );

    expect(screen.getByText(/Session Refresh \/ Exit Violation/i)).toBeInTheDocument();
    expect(screen.getByText('This link is expired it is one time use')).toBeInTheDocument();
    expect(
      screen.getByText('The candidate refreshed or closed the page during the live interview.')
    ).toBeInTheDocument();
  });

  it('displays terminated message with individual warning breakdown and warning count for 3 strikes', () => {
    render(
      <ExpiredInterviewLink
        reason="violation"
        violationReason="Three proctoring warnings issued (2 face/gaze violation(s), 1 unauthorized object(s)). Session auto-terminated."
        warningCount={3}
      />
    );

    expect(screen.getByText(/Proctoring Limit Exceeded \(3 Strikes\)/i)).toBeInTheDocument();
    expect(screen.getByText('This link is expired it is one time use')).toBeInTheDocument();
    expect(
      screen.getByText('Three proctoring warnings issued (2 face/gaze violation(s), 1 unauthorized object(s)). Session auto-terminated.')
    ).toBeInTheDocument();
    expect(screen.getByText('Warnings Logged: 3')).toBeInTheDocument();
  });

  it('displays screen share policy violation with individual reason when screen share stopped', () => {
    render(
      <ExpiredInterviewLink
        reason="violation"
        violationReason="Screen sharing was stopped or disabled."
      />
    );

    expect(screen.getByText(/Screen Share Policy Violation/i)).toBeInTheDocument();
    expect(screen.getByText('This link is expired it is one time use')).toBeInTheDocument();
    expect(screen.getByText('Screen sharing was stopped or disabled.')).toBeInTheDocument();
  });

  it('displays session active on another device screen when interview is currently ongoing', () => {
    render(
      <ExpiredInterviewLink
        reason="concurrent"
        reasonTitle="Interview In Progress on Another Device"
        reasonDetail="An active interview session is already running for this candidate on another device. Simultaneous access from a second device or tab is prohibited."
      />
    );

    expect(screen.getByText(/⚠️ Session Active on Another Device/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Interview In Progress on Another Device/i })).toBeInTheDocument();
    expect(screen.getByText('This interview is currently in progress on another device')).toBeInTheDocument();
    expect(
      screen.getByText('An active interview session is already running for this candidate on another device. Simultaneous access from a second device or tab is prohibited.')
    ).toBeInTheDocument();
    expect(screen.queryByText('This link is expired it is one time use')).not.toBeInTheDocument();
    expect(screen.queryByText(/Single-Use Consumed/i)).not.toBeInTheDocument();
  });
});
