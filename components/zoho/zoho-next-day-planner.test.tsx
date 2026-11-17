// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    localStorage.clear();
    vi.clearAllMocks();
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

    // Click 2h quick chip
    const twoHourChip = screen.getByText('2h');
    fireEvent.click(twoHourChip);

    const addButton = screen.getByRole('button', { name: /Add Task/i });
    fireEvent.click(addButton);

    // Verify task is added to list
    expect(screen.getByText(VALID_TITLE)).toBeDefined();
    expect(screen.getAllByText('2.0 hrs').length).toBeGreaterThanOrEqual(1);
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
    fireEvent.click(screen.getByText('6h'));

    // Submit update
    fireEvent.click(updateButton);

    // Verify task is updated in the list and form resets back to Add Task mode
    expect(screen.getByText(updatedTitle)).toBeDefined();
    expect(screen.queryByText(VALID_TITLE)).toBeNull();
    expect(screen.getByRole('button', { name: /Add Task/i })).toBeDefined();

    // Verify task list portion does not contain any edit buttons (strictly read-only)
    expect(screen.queryByRole('button', { name: /Edit task/i })).toBeNull();
  });
});
