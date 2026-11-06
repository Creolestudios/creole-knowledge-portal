import { ZohoUserSummary, ZohoTaskItem } from '@/lib/zoho/service';
import {
  calculateTimeAdherence,
  evaluateWorkAndCommentMatch,
  computeCompositeTaskScore,
  generateDynamicPerformanceSummary,
} from '@/lib/zoho/heuristics';

interface RawTestCase {
  caseId: string;
  taskName: string;
  taskDescription: string;
  plannedMinutes: number;
  actualMinutes: number;
  zohoStatus: string;
  comments: string[];
  taskDate: string;
  projectName?: string;
  complexityScore?: number;
  repetitionScore?: number;
  isRepetitive?: boolean;
}

interface TestUserDefinition {
  userId: string;
  email: string;
  name: string;
  role: string;
  yearsOfExperience: number;
  seniorityLevel: 'Junior' | 'Mid' | 'Senior';
  aiSubscriptions: string[];
  cases: RawTestCase[];
}

const TEST_USERS_DATA: TestUserDefinition[] = [
  {
    userId: 'test-user-01',
    email: 'test.user1@creolestudios.com',
    name: 'Test User 1',
    role: 'Junior Developer',
    yearsOfExperience: 1,
    seniorityLevel: 'Junior',
    aiSubscriptions: [],
    cases: [
      {
              caseId: 'Case 05',
              taskName: 'Implement Responsive Search Filter on Candidate Roster Page',
              projectName: 'Admin Candidate Roster',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement a responsive search filter on the admin candidate roster page. Create a custom reusable debounce hook with a 300ms delay to eliminate redundant API requests during fast typing. Ensure search queries match candidate names, emails, and primary skill tags case-insensitively, clear active filters with a reset button, and display a proper empty-state UI when no search results match.',
              comments: [
                'Created custom delay hook in hooks/use-debounce.ts with unmount cleanup. Connected to search input and verified in network tab that only one API request fires after typing stops. Added unit test in use-debounce.test.ts.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 11',
              taskName: 'Candidate Roster Search Filter and Query Matching',
              projectName: 'Candidate Roster',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'Backlog',
              taskDescription:
                'Implement a responsive search filter on the admin candidate roster page with debounce hook, case-insensitive query matching, and empty state placeholder.',
              comments: [
                'Created custom delay hook in hooks/use-debounce.ts with unmount cleanup. Connected to search input and verified in network tab. Added unit tests.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 17',
              taskName: 'Refactor Delete Confirmation Modal Component with Accessible Dialog',
              projectName: 'Design System',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 360,  // 6:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Refactor the delete confirmation modal component used across candidate and task management tables. Replace generic browser alerts with an accessible Tailwind modal dialog displaying the specific item name, irreversible deletion warning, and action buttons. Add keyboard trap focus, support Escape key closing, and disable the confirm button while an asynchronous deletion request is pending.',
              comments: ['Completed styling.'],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 20',
              taskName: 'Accessible Tooltip Component for Status Badges Across Portal',
              projectName: 'UI Components',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 90,   // 1:30 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Create an accessible, lightweight tooltip component for status badges across task and candidate tables. Display contextual explanations when users hover or focus on badges indicating On Time, Slight Overrun, Overdue, and In QA Review. Ensure tooltips position dynamically without clipping at viewport boundaries and remain fully readable on touch devices.',
              comments: ['Added tooltips to badges in Badge.tsx. Manually hovered over all 4 badge types to verify text shows.'],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 24',
              taskName: 'Configure Distributed Redis Caching for User Session Management',
              projectName: 'Redis Infrastructure',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Configure distributed Redis caching for user session management and task evaluation state. Setup connection pooling, connection retry strategies with exponential backoff, and local in-memory fallback caches for high-availability failover. Write automated migration scripts in supabase/migrations/ to initialize Redis connection metadata and ensure environment variables are safely validated at boot.',
              comments: ['Pending.'],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 31',
              taskName: 'Header Color Theme Fix and Portal Logo Centering',
              projectName: 'UI Fixes',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription: '1. Fix header color.\n2. Center logo.',
              comments: ['1. Fix header color - Done\n2. Center logo - Done'],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 36',
              taskName: 'Adjust Header Padding on Candidate Summary Modal Dialog',
              projectName: 'Modal Refactoring',
              plannedMinutes: 60,  // 1:00 hr
              actualMinutes: 105, // 1:45 hrs
              zohoStatus: 'In QA Review',
              taskDescription: 'Adjust header padding from 16px to 24px on candidate summary modal.',
              comments: ['Updated classes.'],
              repetitionScore: 6.0,
              isRepetitive: true,
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-02',
    email: 'test.user2@creolestudios.com',
    name: 'Test User 2',
    role: 'Mid-Level Developer',
    yearsOfExperience: 2,
    seniorityLevel: 'Mid',
    aiSubscriptions: [],
    cases: [
      {
              caseId: 'Case 22',
              taskName: 'Update Password Reset Token Security Policies & Expiration',
              projectName: 'Auth Service',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Update password reset token security policies in the authentication service. Shorten reset token validity lifespan from 24 hours to 1 hour, enforce single-use token consumption upon submission, and automatically revoke all active user session cookies immediately after a successful password change. Ensure informative error messaging is displayed if an expired or consumed token is submitted.',
              comments: ['Done.'],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 26',
              taskName: 'Refactor Candidate Interview Weighted Average Scoring Algorithm',
              projectName: 'Scoring Engine',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Refactor candidate interview evaluation calculations to use weighted average scoring algorithms. Calculate overall composite scores based on 45% technical depth, 35% time management, 10% task complexity, and 10% originality. Ensure score normalization handles edge cases like missing sections, format final outputs to one decimal place, and author comprehensive unit tests verifying rounding accuracy.',
              comments: ['WIP, working on it.'],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 33',
              taskName: 'Investigate and Resolve Reported Client Portal Bug',
              projectName: 'Portal Support',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription: 'Fix the bug reported by client on the portal.',
              comments: ['Done and resolved.'],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 35',
              taskName: 'Update Login Modal Button Styling, Padding, and Tokens',
              projectName: 'Design System',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Update button styling, padding, and border radius on the login modal to align with updated design system tokens.',
              comments: [
                'Updated Tailwind classes on LoginForm.tsx and verified button states on hover and focus.',
              ],
              repetitionScore: 6.0,
              isRepetitive: true,
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 43',
              taskName: 'Routine System Updates & Maintenance',
              projectName: 'System Maintenance',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 0,    // 0:00 hrs
              zohoStatus: 'In Progress',
              taskDescription: 'Do updates.',
              comments: [],
              repetitionScore: 5.0,
              isRepetitive: true,
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-03',
    email: 'test.user3@creolestudios.com',
    name: 'Test User 3',
    role: 'Senior Developer',
    yearsOfExperience: 5,
    seniorityLevel: 'Senior',
    aiSubscriptions: [],
    cases: [
      {
              caseId: 'Case 15',
              taskName: 'Customizable Date Range Picker Component for Admin Dashboard',
              projectName: 'Dashboard Analytics',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 270,  // 4:30 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement a customizable date range picker component in the admin evaluation analytics dashboard. Support preset date shortcuts for Today, Yesterday, This Week, and Last 30 Days, alongside custom calendar selection. Ensure start dates cannot exceed end dates, synchronize selected ranges with URL query parameters for shareable views, and update all metric charts reactively without page reloads.',
              comments: ['Date range picker added and working.'],
              taskDate: '2026-11-04',
            },
    ],
  },
  {
    userId: 'test-user-04',
    email: 'test.user4@creolestudios.com',
    name: 'Test User 4',
    role: 'Junior Developer',
    yearsOfExperience: 1,
    seniorityLevel: 'Junior',
    aiSubscriptions: ["GitHub Copilot"],
    cases: [
      {
              caseId: 'Case 01',
              taskName: 'PostgreSQL Row Level Security (RLS) Policies & pgTAP Tests',
              projectName: 'Security Infrastructure',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement strict PostgreSQL Row Level Security (RLS) policies for zoho_tasks and zoho_task_evaluations tables. Restrict SELECT, INSERT, and UPDATE operations so non-admin users only view and modify their own records, while administrators have full organization-wide read and write access. Include idempotent migration scripts in supabase/migrations/, handle multi-tenant isolation, and author automated pgTAP unit tests to verify unauthorized queries return 403 Forbidden.',
              comments: [
                'Created migration 20261030_zoho_rls.sql. Added auth.is_admin() helper and applied tenant filters on zoho_tasks. Authored 8 automated pgTAP test assertions; verified non-admin token receives 403 on colleague evaluations. Moving task to QA Review.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 19',
              taskName: 'Server-Side Pagination Controls for Project Task History Table',
              projectName: 'Data Tables',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 135,  // 2:15 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement server-side pagination controls for the project task history table. Add previous and next page buttons, page number links with ellipsis for large ranges, and a configurable page size selector offering 10, 25, 50, and 100 records per view. Ensure pagination state persists across browser reloads via query parameters, and disable navigation buttons when viewing boundary pages.',
              comments: [
                'Used Copilot to generate pagination controls in components/pagination.tsx. Tested with 120 items and confirmed page bounds work. Moving to QA Review.',
              ],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 25',
              taskName: 'Connect Candidate Interview Feedback Submission Form to Database',
              projectName: 'Feedback Form',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Connect the candidate interview feedback submission form to the Supabase database. Implement asynchronous form submission with CSRF protection, sanitize free-form reviewer comments against XSS, enforce score rating bounds from 1 to 10 across all evaluation categories, and display optimistic UI submission states with graceful rollback if the network request fails.',
              comments: ['Not done yet.'],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 41',
              taskName: 'Automated Zoho Projects Task & Timelog Synchronization Cron Job',
              projectName: 'Zoho Projects Integration',
              plannedMinutes: 480, // 8:00 hrs
              actualMinutes: 495,  // 8:15 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement scheduled cron job to automatically fetch task information for every user from Zoho, including task details, status, assigned users, and associated comments. Configure scheduled execution to ensure regular synchronization of task information and comments with the database. Add error handling for API failures, missing task information, and timelog accuracy. Define and implement evaluation criteria for assessing task completion, work quality, and timelog accuracy.',
              comments: [],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-05',
    email: 'test.user5@creolestudios.com',
    name: 'Test User 5',
    role: 'Mid-Level Developer',
    yearsOfExperience: 3,
    seniorityLevel: 'Mid',
    aiSubscriptions: ["GitHub Copilot"],
    cases: [
      {
              caseId: 'Case 13',
              taskName: 'Interactive Avatar Image Cropping Dialog with Canvas API',
              projectName: 'User Profiles',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 150,  // 2:30 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement an interactive avatar image cropping dialog in the user profile settings page. Allow users to select square crop areas, zoom, and rotate uploaded images before transmission. Compress output images to JPEG format with a maximum resolution of 256x256 pixels, validate image file signatures to block malicious payloads, and upload the cropped binary to the Supabase avatar storage bucket.',
              comments: ['Finished cropping logic with Canvas API. Deployed.'],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 16',
              taskName: 'Responsive Manager KPI Metric Cards for Analytics Dashboard',
              projectName: 'Manager KPI Cards',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 480,  // 8:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Design and build responsive KPI metric cards for the manager task dashboard. Display real-time aggregated metrics for Completed Tasks, In-Progress Tasks, Blocked Tasks, and Average Performance Score. Include percentage change indicators compared to previous week averages, add shimmer loading skeletons during data fetches, and ensure layout adapts smoothly from desktop grid to single-column mobile view.',
              comments: ['Took longer than expected due to CSS issues. Finally completed.'],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 29',
              taskName: 'Redis Client Connection Pooling and Eviction Rules Setup',
              projectName: 'Caching Layer',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                '1. Install redis client package and configure connection pooling.\n2. Add connection pooling helper in lib/redis.ts with error handling.\n3. Cache latest digest endpoint with 15-minute TTL and eviction rules.\n4. Test cache invalidation on new digest creation.',
              comments: [
                '1. Install redis client package - Done\n2. Add connection pooling helper in lib/redis.ts - Done\n3. Cache latest digest endpoint with 15-minute TTL - Done\n4. Test cache invalidation on new digest creation - Done',
              ],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 30',
              taskName: 'Candidate Evaluations PostgreSQL Schema & Authentication Routes',
              projectName: 'Evaluation DB Schema',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                '1. Create PostgreSQL database table for candidate evaluations.\n2. Build CRUD API endpoints with role authentication.\n3. Write unit tests for score calculation formulas.\n4. Deploy schema migration to staging environment.',
              comments: [
                '1. Create database table - Done\n2. Build API endpoint - Done\n3. Write unit tests - Pending\n4. Deploy to staging - Not done',
              ],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 34',
              taskName: 'User Profile Settings Page Enhancements & Email Digest Toggle',
              projectName: 'Profile Management',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription: 'Update user profile settings page.',
              comments: [
                'Added multi-select dropdown for ai_subscriptions, added toggle for daily email digest, created Supabase schema migration 20261102_user_subs.sql, and validated inputs using Zod. Unit tests pass in profile.test.ts.',
              ],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 37',
              taskName: 'Redis Cache TTL Helper and Connection Error Fallback',
              projectName: 'Cache Infrastructure',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription: '', // Completely empty
              comments: [
                'Created lib/zoho/cache.ts with Redis TTL helper. Added error fallback when Redis connection drops. Verified unit tests in cache.test.ts passing.',
              ],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-06',
    email: 'test.user6@creolestudios.com',
    name: 'Test User 6',
    role: 'Mid-Level Developer',
    yearsOfExperience: 3,
    seniorityLevel: 'Mid',
    aiSubscriptions: ["Cursor AI"],
    cases: [
      {
              caseId: 'Case 02',
              taskName: 'Candidate Interview Feedback Notes Modular REST API Endpoints',
              projectName: 'Interview Module',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Build modular REST API endpoints to handle candidate interview feedback notes. Implement GET, POST, PUT, and soft-delete endpoints with pagination and sorting support. Add strict request validation using Zod schemas to validate required fields, score bounds between 1 and 10, and sanitize text inputs against XSS vulnerabilities. Ensure endpoints return consistent JSON error envelopes on validation failures.',
              comments: [
                'Implemented GET, POST, and DELETE routes in app/api/notes/route.ts. Added Zod schema validation for request payloads. Verified responses locally using mock interview payloads. Ready for QA.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 06',
              taskName: 'WebRTC Video Stream Track Switching and External Camera Support',
              projectName: 'WebRTC Interview Suite',
              plannedMinutes: 120, // 2:00 hrs
              actualMinutes: 125,  // 2:05 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Investigate and resolve candidate video stream freezing when toggling between integrated laptop webcams and external USB cameras during active WebRTC interview sessions. Ensure track replacement cleanly stops previous media streams without tearing down the existing ICE peer connection, gracefully handle device permission denials, and prevent camera renegotiation deadlocks on Safari and Chrome.',
              comments: [
                'Fixed video track switching logic in use-camera.ts. Tested with dual webcams. Took 5 extra minutes to verify camera toggle on Safari browser. Moving to QA Review.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 10',
              taskName: 'Candidate Feedback Notes REST Endpoints with Zod Sanitization',
              projectName: 'Interview Notes API',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Build modular REST API endpoints to handle candidate interview feedback notes. Implement GET, POST, PUT, and soft-delete endpoints with pagination and sorting support. Add strict request validation using Zod schemas to validate required fields and sanitize text inputs.',
              comments: [
                'Implemented GET, POST, and DELETE routes in app/api/notes/route.ts. Added Zod schema validation for request payloads. Verified responses locally using mock interview payloads.',
              ],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 12',
              taskName: 'Google OAuth 2.0 PKCE Enterprise Login & Domain Verification',
              projectName: 'Auth & SSO',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 265,  // 4:25 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement Google OAuth 2.0 PKCE authentication flow for enterprise team login. Enforce strict email domain verification restricted to @creolestudios.com corporate accounts only, rejecting all public Google mailboxes. Handle state token validation to prevent CSRF attacks, configure secure refresh token rotation in HTTP-only cookies, and redirect unauthorized domains to an access-request landing page.',
              comments: [
                'Google Cloud console had a redirect URL mismatch on staging which stalled testing for 20 minutes. Fixed redirect settings and verified login works. Unit tests passing for email domain check.',
              ],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 21',
              taskName: 'Role-Based Access Control (RBAC) Middleware for Evaluation Routes',
              projectName: 'Security Middleware',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 60,   // 1:00 hr
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement strict role-based access control (RBAC) middleware protecting 12 admin and evaluation API routes. Extract and verify bearer tokens or signed session cookies on incoming requests, validate user roles against the database cache, and block requests from non-admin accounts with 403 Forbidden responses. Ensure audit logs capture timestamp, user ID, route, and IP address for all unauthorized attempts.',
              comments: ['Used Cursor AI to write the rules quickly. Finished quickly.'],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 27',
              taskName: 'Server-Side PDF Export Route for Candidate Evaluations',
              projectName: 'Reports & Export',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Build a server-side PDF generation route for exporting candidate interview evaluations. Layout header branding, candidate summary details, category breakdown scores, and reviewer technical notes. Optimize PDF rendering to complete under 3 seconds without exhausting server memory, handle multi-page table pagination cleanly, and stream the generated PDF buffer directly to client downloads.',
              comments: [
                'Finished the API endpoint and CSV export in app/api/export/route.ts. Tested with 100 sample records. The PDF export is pending because Puppeteer font rendering fails on Linux staging container. Researching font packages.',
              ],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 32',
              taskName: 'User Notification Settings Database Table & Migration Script',
              projectName: 'User Notifications',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                '1. Create user notification settings table in PostgreSQL.\n2. Add email preference toggles for daily digest.\n3. Write database migration script with foreign keys.',
              comments: [
                '1. Create user notification settings table - Done\n2. Add email preference toggles - Done\n3. Write database migration script - Done\nCreated schema 20261103_notifications.sql. Added foreign key constraint to user_profiles with cascade delete. Verified migration runs cleanly on local Postgres. Moving to QA Review.',
              ],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-07',
    email: 'test.user7@creolestudios.com',
    name: 'Test User 7',
    role: 'Senior Backend Developer',
    yearsOfExperience: 5,
    seniorityLevel: 'Senior',
    aiSubscriptions: ["Cursor AI"],
    cases: [
      {
              caseId: 'Case 14',
              taskName: 'Transactional Email Client & Retry Queue for Performance Summaries',
              projectName: 'Notifications Queue',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 345,  // 5:45 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Integrate a transactional email client to send automated daily performance summaries to engineering managers. Format responsive HTML email templates with daily evaluation scores, task counts, and warning flags. Implement a resilient queue mechanism with exponential backoff retry logic for 429 rate limit errors, and log all dispatch attempts with unique message delivery identifiers.',
              comments: [
                'Encountered third-party email API sandbox outage causing 503 errors for 90 minutes. Monitored provider status page, added retry queue with exponential backoff in lib/email-queue.ts, and verified delivery once service recovered. All tests pass.',
              ],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-08',
    email: 'test.user8@creolestudios.com',
    name: 'Test User 8',
    role: 'Mid-Level Backend Developer',
    yearsOfExperience: 3,
    seniorityLevel: 'Mid',
    aiSubscriptions: ["Antigravity Pro"],
    cases: [
      {
              caseId: 'Case 04',
              taskName: 'WebRTC Candidate Interview Onboarding Flow & E2E Regression Tests',
              projectName: 'WebRTC Interview Suite',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Build the candidate interview onboarding flow and author comprehensive end-to-end regression tests covering the full lifecycle. Implement magic link verification, camera/microphone permission handshakes, and live WebRTC streaming renegotiation. Ensure graceful error boundaries for device disconnections across Chrome, Firefox, and Safari.',
              comments: [
                'Implemented WebRTC onboarding flow in components/interview/onboard.tsx. Authored and executed 16 automated test suites covering all permission states and cross-browser stream renegotiation. All self-tests passed with 100% assertions green. Moving task to In QA Review.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 08',
              taskName: 'Meridian Project-Scoped Searchable Document Library Architecture',
              projectName: 'Meridian Knowledge Base',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 257,  // 4:17 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Will continue developing the project-scoped searchable library for Meridian, supporting document uploads, text extraction, full-text search, secure downloads, and item management. Will complete the Supabase storage migration and prepare the backend foundation for UI integration.',
              comments: [
                'Worked on MAS-302 to implement a centralized, project-scoped library for uploaded documents and horizon-scan items. Implemented the database foundation in the hosted development environment, including default project folders, foundational and must-read tagging, and full-text search. Built backend support for PDF, Word, PowerPoint, and plain-text uploads, including text extraction for searchable content. Implemented secure download links and library item deletion. Confirmed that legacy .doc and .ppt files can be stored but are not yet searchable; audio and video support remain deferred. Completed Phase 2 storage, upload, download, and delete functionality, with local testing and API/extraction tests passing.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 09',
              taskName: 'HMAC-SHA256 Webhook Verification on Incoming Zoho Projects Events',
              projectName: 'Zoho Webhooks',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Implement HMAC-SHA256 webhook signature verification for incoming Zoho Projects event webhooks on /api/webhooks/zoho. Verify incoming request signatures using constant-time crypto comparison against the shared webhook secret, reject requests with timestamps older than 5 minutes to prevent replay attacks, and return proper 401 Unauthorized responses for invalid payloads.',
              comments: [
                'Implemented constant-time crypto comparison in lib/zoho/webhook-auth.ts. Added unit tests for replay attacks and tampered payloads. Verification completed locally.',
              ],
              taskDate: '2026-11-03',
            },
    ],
  },
  {
    userId: 'test-user-09',
    email: 'test.user9@creolestudios.com',
    name: 'Test User 9',
    role: 'Senior Full Stack Architect',
    yearsOfExperience: 5,
    seniorityLevel: 'Senior',
    aiSubscriptions: ["Antigravity Pro","Cursor AI"],
    cases: [
      {
              caseId: 'Case 18',
              taskName: 'Candidate Signup Server-Side Email Validation & Domain Blocklist',
              projectName: 'Auth & Security',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 120,  // 2:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement strict server-side email validation and domain blocklist verification on candidate signup endpoints. Check email strings against standard RFC 5322 regex formatting, detect and reject disposable temporary email providers, verify MX domain records, and sanitize input against SQL injection. Return descriptive localized error messages when email addresses fail validation checks.',
              comments: [
                'Built validation utility in lib/validators.ts. Authored 14 automated unit tests covering disposable email domains, invalid TLDs, and boundary conditions. All 14 tests passing. Finished ahead of schedule due to existing regex library.',
              ],
              taskDate: '2026-11-02',
            },
      {
              caseId: 'Case 40',
              taskName: 'User Profile Daily Digest Boolean Preference & Settings Toggle',
              projectName: 'User Preferences',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 330,  // 5:30 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Add a new user preference boolean setting daily_digest_enabled to the user_profiles table with default value true. Update Supabase database schema migrations, add validation rules in the user profile settings API route handler, and expose a responsive toggle switch on the user account notification preferences screen.',
              comments: ['Added column and updated user settings form.'],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-10',
    email: 'test.user10@creolestudios.com',
    name: 'Test User 10',
    role: 'Mid-Level Developer',
    yearsOfExperience: 2,
    seniorityLevel: 'Mid',
    aiSubscriptions: ["ChatGPT Plus"],
    cases: [
      {
              caseId: 'Case 07',
              taskName: 'Client-Side Excel & CSV Export Action with PapaParse in Zoho Manager',
              projectName: 'Analytics Manager',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 165,  // 2:45 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Build a client-side Excel and CSV download action in the Zoho task evaluation manager. Include formatted columns for evaluation date, developer name, assigned task title, planned hours, logged hours, performance score, and review status. Implement PapaParse with UTF-8 BOM encoding to ensure full Microsoft Excel compatibility, and handle large dataset exports of 500+ rows without freezing the UI thread.',
              comments: [
                'Added Excel export button using PapaParse library in components/export-btn.tsx. Verified file download with 50 rows of mock task data on Chrome and Edge. Finished 15 mins early.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 23',
              taskName: 'Active Interview Audio Streaming WebSocket Memory Leak Investigation',
              projectName: 'Audio Streaming',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Investigate and eliminate a memory leak occurring in the active interview audio streaming handler. Profile WebSocket connection lifecycles, identify uncollected event listeners on peer disconnections, and ensure audio stream buffers and media tracks are explicitly stopped and garbage collected upon session termination. Verify that browser tab memory usage remains stable below 120MB over extended 45-minute calls.',
              comments: ['Fixed.'],
              taskDate: '2026-11-03',
            },
      {
              caseId: 'Case 38',
              taskName: 'Configure OAuth Google Authentication Credentials and Session Callbacks',
              projectName: 'OAuth Integration',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 180,  // 3:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Configure OAuth Google authentication credentials and session callback route handlers for corporate login.',
              comments: [
                'Worked on footer copyright styling, fixed social media icons, and adjusted mobile padding.',
              ],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-11',
    email: 'test.user11@creolestudios.com',
    name: 'Test User 11',
    role: 'Senior Developer',
    yearsOfExperience: 5,
    seniorityLevel: 'Senior',
    aiSubscriptions: ["ChatGPT Plus"],
    cases: [
      {
              caseId: 'Case 39',
              taskName: 'Database Query Performance Optimization on Zoho Evaluations Table',
              projectName: 'Database Optimization',
              plannedMinutes: 240, // 4:00 hrs
              actualMinutes: 240,  // 4:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Perform database query performance optimization on the zoho_task_evaluations table. Analyze slow query logs, identify missing indexes on high-frequency query filters, add composite B-tree indexes on (user_id, task_date), and tune PgBouncer connection pooling parameters to prevent connection starvation during automated hourly synchronization cron jobs.',
              comments: ['Optimized queries and updated pool settings. Everything works fine and moved to In QA Review.'],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-12',
    email: 'test.user12@creolestudios.com',
    name: 'Test User 12',
    role: 'Mid-Level Developer',
    yearsOfExperience: 3,
    seniorityLevel: 'Mid',
    aiSubscriptions: ["Claude Pro"],
    cases: [
      {
              caseId: 'Case 42',
              taskName: 'Redis Pub/Sub Pipeline for Real-Time Interview Room Event Streaming',
              projectName: 'Realtime Pipeline',
              plannedMinutes: 180, // 3:00 hrs
              actualMinutes: 0,    // 0:00 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Implement a Redis Pub/Sub messaging pipeline to broadcast real-time interview room events to active admin monitors. Define event channels for candidate join, audio degradation, screen share toggle, and interview completion. Implement automatic socket reconnection with exponential backoff and buffer offline messages to prevent event loss during network flickers.',
              comments: [
                'Built lib/events/redis-bus.ts. Added heartbeat ping every 15s to keep connections alive. Verified across two simulated worker processes. Unit tests passing.',
              ],
              taskDate: '2026-11-02',
            },
    ],
  },
  {
    userId: 'test-user-13',
    email: 'test.user13@creolestudios.com',
    name: 'Test User 13',
    role: 'Senior Backend Engineer',
    yearsOfExperience: 5,
    seniorityLevel: 'Senior',
    aiSubscriptions: ["Claude Pro"],
    cases: [
      {
              caseId: 'Case 03',
              taskName: 'Candidate Portal Login Latency Optimization with Distributed Redis',
              projectName: 'Performance & Scale',
              plannedMinutes: 360, // 6:00 hrs
              actualMinutes: 350,  // 5:50 hrs
              zohoStatus: 'In QA Review',
              taskDescription:
                'Investigate and resolve candidate portal login latency under high concurrency. Replace existing database-backed session lookups with a distributed Redis caching layer. Implement connection pooling, automatic failover with local memory fallback, and session token invalidation upon logout. The system must maintain under 100ms p95 response time during a simulated 500 concurrent user load test without dropping active socket connections.',
              comments: [
                'Added Redis caching in lib/session.ts to stop redundant database queries on every page refresh. Ran load test simulating 500 concurrent sessions; page response time dropped from 2.4 seconds to 95 milliseconds. Passed all test suites.',
              ],
              taskDate: '2026-11-04',
            },
      {
              caseId: 'Case 28',
              taskName: 'Multi-Factor Authentication (MFA) with TOTP & SMS Fallback Flow',
              projectName: 'MFA Security',
              plannedMinutes: 300, // 5:00 hrs
              actualMinutes: 300,  // 5:00 hrs
              zohoStatus: 'In Progress',
              taskDescription:
                'Implement multi-factor authentication (MFA) supporting time-based one-time password (TOTP) authenticator apps and SMS fallback. Generate secure base32 secret keys with QR code rendering for authenticator enrollment, provide 10 single-use emergency recovery backup codes, and enforce 6-digit TOTP token verification before issuing authenticated session tokens.',
              comments: [
                'Completed Authenticator app TOTP flow with QR code generation in lib/auth/mfa.ts. Verified enrollment and token verification. SMS OTP is deferred to tomorrow pending Twilio account phone number approval.',
              ],
              taskDate: '2026-11-03',
            },
    ],
  },
];

export function getTestDatasetUsers(dateRange?: { start?: string; end?: string; startDate?: string; endDate?: string }): ZohoUserSummary[] {
  return TEST_USERS_DATA.map((uDef) => {
    const taskItems: ZohoTaskItem[] = uDef.cases.map((c, index) => {
      const plannedMins = c.plannedMinutes;
      const actualMins = c.actualMinutes;
      const isQAReview = Boolean(c.zohoStatus && c.zohoStatus.toLowerCase().includes('qa'));

      // Real live evaluation engine runs here dynamically!
      const timeAdh = calculateTimeAdherence(plannedMins, actualMins);
      const workMatchResult = evaluateWorkAndCommentMatch(c.taskDescription, c.comments, {
        taskName: c.taskName,
        plannedMinutes: plannedMins,
        actualMinutes: actualMins,
      });

      const complexityScore = c.complexityScore ?? 8.0;
      const repetitionScore = c.repetitionScore ?? 10.0;
      const workMatchScore = workMatchResult.workMatchScore;
      const timeScore = timeAdh.timeScore;
      const timeAssessmentLabel = timeAdh.assessmentLabel;
      const variance = timeAdh.timeVarianceMinutes;

      const overallScore = computeCompositeTaskScore({
        timeScore,
        commentQualityScore: workMatchScore,
        complexityScore,
        repetitionScore,
        isQAReview,
        isBriefDescription: workMatchResult.isBriefDescription,
      });

      const dyn = generateDynamicPerformanceSummary({
        taskDescription: c.taskDescription,
        comments: c.comments,
        timeAssessmentLabel,
        workMatchScore,
        seniorityLevel: uDef.seniorityLevel,
        userExperienceYears: uDef.yearsOfExperience,
        aiSubscriptions: uDef.aiSubscriptions,
        isQAReview,
        complexityScore,
        repetitionScore,
        isRepetitive: c.isRepetitive,
        plannedMinutes: plannedMins,
        actualMinutes: actualMins,
        timeScore,
      });

      const evalItem = {
        overallScore: Math.min(10.0, overallScore),
        timeScore,
        workMatchScore,
        commentQualityScore: workMatchScore,
        complexityScore,
        repetitionScore,
        timeVarianceMinutes: variance,
        timeAssessmentLabel,
        isRepetitive: c.isRepetitive || false,
        repetitionSimilarityPct: c.isRepetitive ? 68 : 0,
        matchedTaskId: null,
        workMatchFeedback: workMatchResult.explanation,
        summaryFeedback: dyn.performanceSummary,
        whereLacked: dyn.whereLacked,
        whereToImprove: dyn.whereToImprove,
        improvementItems: dyn.improvementItems,
        strengths: [
          workMatchScore >= 8.0 ? 'Progress comments justify the task implementation scope.' : 'Task actively tracked in Zoho Projects.',
          timeScore === 10 ? 'Maintained disciplined delivery within permitted time tolerance buffer.' : 'Work logged and reviewed.',
        ],
        improvements: dyn.improvementItems,
        hasPendingScope: workMatchResult.hasPendingScope,
        isPartialDelivery: workMatchResult.isPartialDelivery,
        hasMeetingLogged: workMatchResult.hasMeetingLogged,
        hasDocumentedBlockers: workMatchResult.hasDocumentedBlockers,
        aiModelUsed: 'engineering-rule-engine',
      };

      return {
        id: `test-task-${uDef.userId}-${index + 1}`,
        zohoTaskId: `ZOHO-TEST-${index + 1}`,
        projectId: `proj-${index + 1}`,
        projectName: c.projectName || 'Creole Knowledge Portal',
        taskName: `${c.taskName} [${c.caseId}]`,
        taskDescription: c.taskDescription,
        zohoStatus: c.zohoStatus,
        isQAReview,
        plannedHours: Math.round((plannedMins / 60) * 10) / 10,
        actualHours: Math.round((actualMins / 60) * 10) / 10,
        plannedMinutes: plannedMins,
        actualMinutes: actualMins,
        taskDate: c.taskDate,
        zohoLink: '',
        comments: c.comments.map((text) => ({
          author: uDef.name.split(' (')[0],
          content: text,
          time: `${c.taskDate} 06:30 PM`,
        })),
        evaluation: evalItem,
      };
    });

    const filterStart = dateRange?.start || dateRange?.startDate;
    const filterEnd = dateRange?.end || dateRange?.endDate;

    // 1. All tasks (Cumulative Till-Date up to filterEnd or all tasks)
    const upToDateTasks = filterEnd
      ? taskItems.filter((t) => t.taskDate <= filterEnd)
      : taskItems;

    const allDaysMap = new Map<string, ZohoTaskItem[]>();
    let tillDone = 0;
    let tillQAReview = 0;
    let tillPending = 0;
    let tillDelayed = 0;
    let tillHours = 0;
    let tillScoreSum = 0;

    for (const item of upToDateTasks) {
      const date = item.taskDate;
      if (!allDaysMap.has(date)) allDaysMap.set(date, []);
      allDaysMap.get(date)!.push(item);

      tillHours += item.actualHours || 0;
      tillScoreSum += item.evaluation?.overallScore || 0;
      if (item.evaluation?.timeAssessmentLabel === 'OVERDUE') tillDelayed++;

      const st = (item.zohoStatus || '').toLowerCase();
      const isClosed = st.includes('closed') || st.includes('completed') || (st.includes('done') && !st.includes('qa'));
      const isQA = Boolean(item.isQAReview || st.includes('qa') || st.includes('review'));

      if (isClosed) {
        tillDone++;
      } else if (isQA) {
        tillQAReview++;
      } else {
        tillPending++;
      }
    }

    const allDailyEvaluationsUpToDate = Array.from(allDaysMap.entries()).map(([date, tList]) => {
      const dayScoreSum = tList.reduce((sum, it) => sum + (it.evaluation?.overallScore || 0), 0);
      const dayScore = tList.length > 0 ? Math.round((dayScoreSum / tList.length) * 10) / 10 : 8.5;
      return {
        date,
        dayScore,
        summary: `Completed ${tList.length} task(s) on ${date}.`,
        tasks: tList,
      };
    });

    const tillDateSummary = {
      doneTasks: tillDone,
      qaReviewTasks: tillQAReview,
      pendingTasks: tillPending,
      delayedTasks: tillDelayed,
      weeklyAvgScore: upToDateTasks.length > 0 ? Math.min(100, Math.round((tillScoreSum / upToDateTasks.length) * 10)) : 0,
      totalHoursLogged: Math.round(tillHours * 10) / 10,
    };

    // 2. Active tasks strictly within the filtered date range (for current week / month view)
    const activeTasks = (filterStart && filterEnd)
      ? taskItems.filter((t) => t.taskDate >= filterStart && t.taskDate <= filterEnd)
      : taskItems;

    const activeDaysMap = new Map<string, ZohoTaskItem[]>();
    let activeDone = 0;
    let activeQAReview = 0;
    let activePending = 0;
    let activeDelayed = 0;
    let activeHours = 0;
    let activeScoreSum = 0;

    for (const item of activeTasks) {
      const date = item.taskDate;
      if (!activeDaysMap.has(date)) activeDaysMap.set(date, []);
      activeDaysMap.get(date)!.push(item);

      activeHours += item.actualHours || 0;
      activeScoreSum += item.evaluation?.overallScore || 0;
      if (item.evaluation?.timeAssessmentLabel === 'OVERDUE') activeDelayed++;

      const st = (item.zohoStatus || '').toLowerCase();
      const isClosed = st.includes('closed') || st.includes('completed') || (st.includes('done') && !st.includes('qa'));
      const isQA = Boolean(item.isQAReview || st.includes('qa') || st.includes('review'));

      if (isClosed) {
        activeDone++;
      } else if (isQA) {
        activeQAReview++;
      } else {
        activePending++;
      }
    }

    const dailyEvaluations = Array.from(activeDaysMap.entries()).map(([date, tList]) => {
      const dayScoreSum = tList.reduce((sum, it) => sum + (it.evaluation?.overallScore || 0), 0);
      const dayScore = tList.length > 0 ? Math.round((dayScoreSum / tList.length) * 10) / 10 : 8.5;
      return {
        date,
        dayScore,
        summary: `Completed ${tList.length} task(s) on ${date}.`,
        tasks: tList,
      };
    });

    const filterSummary = {
      doneTasks: activeDone,
      qaReviewTasks: activeQAReview,
      pendingTasks: activePending,
      delayedTasks: activeDelayed,
      weeklyAvgScore: activeTasks.length > 0 ? Math.min(100, Math.round((activeScoreSum / activeTasks.length) * 10)) : 0,
      totalHoursLogged: Math.round(activeHours * 10) / 10,
    };

    return {
      userId: uDef.userId,
      email: uDef.email,
      name: uDef.name,
      role: uDef.role,
      yearsOfExperience: uDef.yearsOfExperience,
      seniorityLevel: uDef.seniorityLevel,
      aiSubscriptions: uDef.aiSubscriptions,
      seniorEmails: [],
      dailyEmailEnabled: false,
      filterSummary,
      tillDateSummary,
      dailyEvaluations,
      allDailyEvaluationsUpToDate,
    };
  });
}
