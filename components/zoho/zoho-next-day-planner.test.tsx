// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ZohoNextDayPlanner from './zoho-next-day-planner';

const VALID_TITLE = 'Fix user profile picture upload & avatar endpoint';
const VALID_DESC_40_WORDS =
  'Fix the user profile picture upload endpoint using AWS S3 presigned URLs. Validate file types to accept only JPEG, PNG, and WebP up to 5MB. Implement client-side crop preview modal in React. Write unit tests for avatar validation logic and API route integration tests covering error boundaries and unauthorized attempts.';

const VALID_DB_TITLE = 'Optimize database SQL queries & add composite indexes';
const VALID_DB_DESC_40_WORDS =
  'Optimize slow database SQL queries on the main task listing table. Add composite indexes on user_id and task_date to reduce query execution latency from 450ms down to 40ms. Run PostgreSQL EXPLAIN ANALYZE queries and update automated performance regression tests in Vitest.';

describe('ZohoNextDayPlanner Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the planner header and target project dropdown', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    expect(screen.getByText(/Plan Tomorrow's Tasks|Plan Monday's Tasks/i)).toBeDefined();
    expect(screen.getByText(/Target Project/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Implement user profile picture upload/i)).toBeDefined();
    expect(screen.getByText(/Add Task/i)).toBeDefined();
  });

  it('disables Add Task button and shows guidance note when description has fewer than 40 words', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    const titleInput = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(titleInput, { target: { value: VALID_TITLE } });

    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: 'Fix user profile picture upload bug.' } }); // 6 words

    // Check guidance note with word count
    expect(screen.getByText(/Detailed Scope Required:/i)).toBeDefined();
    expect(screen.getByText(/6 \/ 40 words min/i)).toBeDefined();

    // Add button should be disabled
    const addButton = screen.getByRole('button', { name: /Add Task/i });
    expect(addButton.hasAttribute('disabled')).toBe(true);
  });

  it('disables Add Task button and shows warning when task title is vague', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    const titleInput = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(titleInput, { target: { value: 'bug fix' } });

    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });

    expect(screen.getByText(/Task Title is too vague/i)).toBeDefined();

    const addButton = screen.getByRole('button', { name: /Add Task/i });
    expect(addButton.hasAttribute('disabled')).toBe(true);
  });

  it('disables Add Task button when title and description are irrelevant to each other', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    const titleInput = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(titleInput, { target: { value: 'Refactor Stripe billing invoice calculations' } });

    // Description is about avatar uploads, completely irrelevant to Stripe billing
    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });

    expect(screen.getByText(/Relevance Check:/i)).toBeDefined();

    const addButton = screen.getByRole('button', { name: /Add Task/i });
    expect(addButton.hasAttribute('disabled')).toBe(true);
  });

  it('enables Add Task button when title is specific, description has 40+ words and is relevant', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    const titleInput = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(titleInput, { target: { value: VALID_TITLE } });

    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });

    const addButton = screen.getByRole('button', { name: /Add Task/i });
    expect(addButton.hasAttribute('disabled')).toBe(false);
  });

  it('allows user to enter valid task title and 40+ word description, and add task to planned list', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    const input = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(input, { target: { value: VALID_TITLE } });

    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });

    // Set planned hours via duration input
    const hoursInput = screen.getByLabelText(/Planned duration/i);
    fireEvent.change(hoursInput, { target: { value: '2' } });

    const addButton = screen.getByRole('button', { name: /Add Task/i });
    fireEvent.click(addButton);

    // Verify task is added to list with clock format
    expect(screen.getByText(VALID_TITLE)).toBeDefined();
    expect(screen.getAllByText('2:00 hrs').length).toBeGreaterThanOrEqual(1);
  });

  it('allows user to delete a planned task', () => {
    render(<ZohoNextDayPlanner userName="Krunal Patel" userEmail="krunal@creolestudios.com" />);

    // Add a task first with valid fields
    const input = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(input, { target: { value: VALID_DB_TITLE } });
    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DB_DESC_40_WORDS } });
    const addButton = screen.getByRole('button', { name: /Add Task/i });
    fireEvent.click(addButton);

    expect(screen.getByText(VALID_DB_TITLE)).toBeDefined();

    // Delete the task
    const deleteBtn = screen.getByLabelText(new RegExp(`Delete task ${VALID_DB_TITLE}`, 'i'));
    fireEvent.click(deleteBtn);

    expect(screen.queryByText(VALID_DB_TITLE)).toBeNull();
  });

  it('toggles collapse and expand when header chevron is clicked', () => {
    render(<ZohoNextDayPlanner userName="Aman Kumar" userEmail="aman@creolestudios.com" />);

    const toggleBtn = screen.getByLabelText(/Collapse planner/i);
    fireEvent.click(toggleBtn);

    // Form inputs should not be visible when collapsed
    expect(screen.queryByPlaceholderText(/Implement user profile picture upload/i)).toBeNull();

    const expandBtn = screen.getByLabelText(/Expand planner/i);
    fireEvent.click(expandBtn);

    // Form inputs should be visible again
    expect(screen.getByPlaceholderText(/Implement user profile picture upload/i)).toBeDefined();
  });

  it('allows user to search and select a project in project dropdown', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    // Click project dropdown button
    const projectBtn = screen.getByLabelText(/Select target project/i);
    fireEvent.click(projectBtn);

    // Search input should be visible
    const searchInput = screen.getByPlaceholderText(/Search project.../i);
    expect(searchInput).toBeDefined();

    // Type query
    fireEvent.change(searchInput, { target: { value: 'Mobile' } });
    expect(screen.getByText('Mobile App Development')).toBeDefined();

    // Select the filtered project
    fireEvent.click(screen.getByText('Mobile App Development'));
    expect(screen.getByText('Mobile App Development')).toBeDefined();
  });

  it('allows user to select and edit tomorrow planned task before cutoff without mentioning cutoff in edit UI', () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);

    // Add a task first
    const input = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(input, { target: { value: VALID_TITLE } });
    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });
    const addButton = screen.getByRole('button', { name: /Add Task/i });
    fireEvent.click(addButton);

    expect(screen.getByText(VALID_TITLE)).toBeDefined();

    // Open task selection dropdown with search
    const taskSelectBtn = screen.getByLabelText(/Select task to edit/i);
    fireEvent.click(taskSelectBtn);

    // Search within planned tasks
    const taskSearchInput = screen.getByPlaceholderText(/Search tomorrow's tasks.../i);
    fireEvent.change(taskSearchInput, { target: { value: 'Fix user' } });

    // Click task item to load into form for editing
    const selectTaskItem = screen.getAllByText(VALID_TITLE)[0];
    fireEvent.click(selectTaskItem);

    // Verify form enters edit mode and button text updates to "Update Task"
    const updateButton = screen.getByRole('button', { name: /Update Task/i });
    expect(updateButton).toBeDefined();
    expect(screen.getByText(/Cancel Edit/i)).toBeDefined();

    // Change title and hours
    const updatedTitle = 'Update avatar endpoint and user profile picture upload logic';
    fireEvent.change(screen.getByPlaceholderText(/Implement user profile picture upload/i), {
      target: { value: updatedTitle },
    });
    const hoursInput = screen.getByLabelText(/Planned duration/i);
    fireEvent.change(hoursInput, { target: { value: '3' } });

    // Submit update
    fireEvent.click(updateButton);

    // Verify task is updated in the list and form resets back to Add Task mode
    expect(screen.getByText(updatedTitle)).toBeDefined();
    expect(screen.queryByText(VALID_TITLE)).toBeNull();
    expect(screen.getByRole('button', { name: /Add Task/i })).toBeDefined();

    // Verify task list portion does not contain any edit buttons (strictly read-only)
    expect(screen.queryByRole('button', { name: /Edit task/i })).toBeNull();
  });

  it('allows user to click Bullet List button to insert bullet point in description', () => {
    render(<ZohoNextDayPlanner userName="Srushti Amin" userEmail="srushti@creolestudios.com" />);

    const bulletBtn = screen.getByRole('button', { name: /Bullet List/i });
    fireEvent.click(bulletBtn);

    const descTextarea = screen.getByPlaceholderText(/Describe acceptance criteria/i) as HTMLTextAreaElement;
    expect(descTextarea.value).toContain('• ');
  });

  it('opens task details modal card on click and closes when clicking cross X', () => {
    render(<ZohoNextDayPlanner userName="Srushti Amin" userEmail="srushti@creolestudios.com" />);

    const input = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    fireEvent.change(input, { target: { value: VALID_DB_TITLE } });
    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    fireEvent.change(descInput, { target: { value: VALID_DB_DESC_40_WORDS } });
    const addButton = screen.getByRole('button', { name: /Add Task/i });
    fireEvent.click(addButton);

    // Click the task item to open the details modal
    fireEvent.click(screen.getByText(VALID_DB_TITLE));

    // Verify modal contains full deliverable scope
    expect(screen.getByText(/Full Deliverables & Technical Scope/i)).toBeDefined();

    // Click the close cross button
    const closeBtn = screen.getByRole('button', { name: /Close task details/i });
    fireEvent.click(closeBtn);

    // Verify modal is closed
    expect(screen.queryByText(/Full Deliverables & Technical Scope/i)).toBeNull();
  });

  it('allows user to enter flexible durations from 1 min to 4 hrs (e.g. 15m, 1m, 1.5, 4h)', () => {
    render(<ZohoNextDayPlanner userName="Akash Jakhaniya" userEmail="akash@creolestudios.com" />);

    const titleInput = screen.getByPlaceholderText(/Implement user profile picture upload/i);
    const descInput = screen.getByPlaceholderText(/Describe acceptance criteria/i);
    const hoursInput = screen.getByLabelText(/Planned duration/i);
    const addButton = screen.getByRole('button', { name: /Add Task/i });

    // Test 1: Enter 15 minutes (15m)
    fireEvent.change(titleInput, { target: { value: VALID_TITLE } });
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });
    fireEvent.change(hoursInput, { target: { value: '15m' } });

    // Header badge reflects 0:15 hrs
    expect(screen.getByText(/0:15 hrs \(0\.25h\)/i)).toBeDefined();
    expect(addButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(addButton);

    // Verify task is added with 0:15 hrs (present on task card and total planned)
    expect(screen.getAllByText('0:15 hrs').length).toBeGreaterThanOrEqual(1);

    // Test 2: Enter 1 minute (1m)
    fireEvent.change(titleInput, { target: { value: VALID_DB_TITLE } });
    fireEvent.change(descInput, { target: { value: VALID_DB_DESC_40_WORDS } });
    fireEvent.change(hoursInput, { target: { value: '1m' } });
    expect(screen.getByText(/0:01 hrs \(0\.02h\)/i)).toBeDefined();
    fireEvent.click(addButton);
    expect(screen.getAllByText('0:01 hrs').length).toBeGreaterThanOrEqual(1);

    // Test 3: Enter clock format 01:30
    fireEvent.change(titleInput, { target: { value: 'Refactor analytics aggregate calculation routines' } });
    fireEvent.change(descInput, { target: { value: VALID_DESC_40_WORDS } });
    fireEvent.change(hoursInput, { target: { value: '01:30' } });
    expect(screen.getByText(/1:30 hrs \(1\.5h\)/i)).toBeDefined();
    fireEvent.click(addButton);
    expect(screen.getAllByText('1:30 hrs').length).toBeGreaterThanOrEqual(1);

    // Test 4: Enter invalid duration under 1 min (00:00 / 0m)
    fireEvent.change(hoursInput, { target: { value: '00:00' } });
    expect(screen.getByText(/Duration must be at least 00:01 \(1 min\)/i)).toBeDefined();
    expect(addButton.hasAttribute('disabled')).toBe(true);

    // Test 5: Enter invalid duration exceeding 4 hours (05:00 / 5h)
    fireEvent.change(hoursInput, { target: { value: '05:00' } });
    expect(screen.getByText(/Duration cannot exceed 04:00 \(4 hrs\)/i)).toBeDefined();
    expect(addButton.hasAttribute('disabled')).toBe(true);

    // Test 6: Strictly clamp to max 2 digits on each side (prevents typing 01:4544 or 123:45)
    fireEvent.change(hoursInput, { target: { value: '01:4544' } });
    expect((hoursInput as HTMLInputElement).value).toBe('01:45');

    fireEvent.change(hoursInput, { target: { value: '123:45' } });
    expect((hoursInput as HTMLInputElement).value).toBe('12:45');

    // Test 7: Enter minutes > 59 (e.g. 01:80)
    fireEvent.change(hoursInput, { target: { value: '01:80' } });
    expect(screen.getByText(/Minutes cannot exceed 59/i)).toBeDefined();
    expect(addButton.hasAttribute('disabled')).toBe(true);
  });

  it('renders refresh button and allows refreshing live projects from Zoho', async () => {
    render(<ZohoNextDayPlanner userName="Priya Sharma" userEmail="priya@creolestudios.com" />);
    const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
    expect(refreshBtn).toBeDefined();
    fireEvent.click(refreshBtn);
  });
});
