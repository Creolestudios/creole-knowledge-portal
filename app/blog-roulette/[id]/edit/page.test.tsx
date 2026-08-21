// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlogEditPage from './page';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/blog-roulette/blog-1/edit',
  useParams: () => ({ id: 'blog-1' }),
}));

vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const mockGetUser = vi.fn();
const mockOrder = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser: (...args: any[]) => mockGetUser(...args), signOut: vi.fn().mockResolvedValue({}) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: (...args: any[]) => mockOrder(...args),
            }),
          }),
          single: (...args: any[]) => mockOrder(...args),
        }),
      }),
    }),
  }),
}));

vi.mock('@tinymce/tinymce-react', () => ({
  Editor: ({ value, onEditorChange, disabled }: any) => (
    <textarea
      data-testid="tinymce-editor"
      value={value}
      disabled={disabled}
      onChange={(e) => onEditorChange(e.target.value)}
    />
  ),
}));

vi.mock('@/components/blog-roulette/checklist-sidebar', () => ({
  default: ({ result }: any) => <div data-testid="checklist">{result.passed ? 'PASS' : 'INCOMPLETE'}</div>,
}));
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>fake-diagram</svg>' }),
  },
}));
vi.mock('motion/react', () => {
  const MotionStub = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => {
    const { initial, animate, transition, ...domProps } = props;
    return <div {...domProps}>{children}</div>;
  };
  return {
    motion: new Proxy(
      {},
      {
        get: () => MotionStub,
      },
    ),
  };
});

function apiBlog(overrides: Partial<any> = {}) {
  return {
    id: 'blog-1',
    title: 'My Draft Blog',
    status: 'DRAFT',
    body_html: '<p>content</p>',
    seo_title: 'SEO title',
    meta_description: '',
    tldr: '',
    cover_image_url: '',
    word_count: 10,
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function fetchImpl(map: Record<string, any>) {
  return vi.fn().mockImplementation((url: string, opts?: any) => {
    if (url === '/api/blog-roulette/blog-1' && (!opts || opts.method === undefined)) {
      return Promise.resolve(map.get ?? { ok: true, json: async () => ({ blog: apiBlog(), tags: ['react'] }) });
    }
    if (url === '/api/blog-roulette/blog-1' && opts?.method === 'PATCH') {
      return Promise.resolve(map.patch ?? { ok: true, json: async () => ({ ok: true }) });
    }
    if (url.includes('/ai-score')) {
      return Promise.resolve(map.aiScore ?? { ok: true, json: async () => ({ score: 20, signals: [] }) });
    }
    if (url.includes('/submit')) {
      return Promise.resolve(map.submit ?? { ok: true, json: async () => ({ ok: true }) });
    }
    if (url.includes('/unlock')) {
      return Promise.resolve(map.unlock ?? { ok: true, json: async () => ({ ok: true }) });
    }
    if (url.includes('/upload')) {
      return Promise.resolve(map.upload ?? { ok: true, json: async () => ({ url: 'https://cdn.x/img.png' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('BlogEditPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@creolestudios.com' } } });
    mockOrder.mockResolvedValue({ data: [] });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('redirects away when the blog cannot be loaded', async () => {
    global.fetch = fetchImpl({ get: { ok: false, json: async () => ({}) } });
    render(<BlogEditPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/blog-roulette');
    });
  });

  it('loads and displays the draft blog for editing', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);

    await waitFor(() => {
      expect(screen.getByText('My Draft Blog')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tinymce-editor')).not.toBeDisabled();
    expect(screen.getByText('react')).toBeInTheDocument();
  });

  it('shows the published view for a PUBLISHED blog instead of the editor', async () => {
    global.fetch = fetchImpl({ get: { ok: true, json: async () => ({ blog: apiBlog({ status: 'PUBLISHED' }), tags: [] }) } });
    render(<BlogEditPage />);

    await waitFor(() => {
      expect(screen.getByText('My Draft Blog')).toBeInTheDocument();
      expect(screen.getByText('Published')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('tinymce-editor')).not.toBeInTheDocument();
  });

  it('locks the editor fields once the blog is no longer DRAFT', async () => {
    global.fetch = fetchImpl({ get: { ok: true, json: async () => ({ blog: apiBlog({ status: 'SUBMITTED' }), tags: [] }) } });
    render(<BlogEditPage />);

    await waitFor(() => screen.getByTestId('tinymce-editor'));
    expect(screen.getByTestId('tinymce-editor')).toBeDisabled();
  });

  it('adds and removes tags', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);
    await waitFor(() => screen.getByText('react'));

    fireEvent.change(screen.getByPlaceholderText('Type a tag and press Enter'), {
      target: { value: 'nextjs' },
    });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText('nextjs')).toBeInTheDocument();

    const tagPill = screen.getByText('nextjs').closest('span')!;
    fireEvent.click(tagPill.querySelector('button')!);
    expect(screen.queryByText('nextjs')).not.toBeInTheDocument();
  });

  it('edits body content through the mocked editor and updates word count', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);
    await waitFor(() => screen.getByTestId('tinymce-editor'));

    fireEvent.change(screen.getByTestId('tinymce-editor'), {
      target: { value: '<p>' + 'word '.repeat(50) + '</p>' },
    });

    await waitFor(() => {
      expect(screen.getByText('50')).toBeInTheDocument(); // word count stat
    });
  });

  it('saves the draft when the Save button is clicked', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);
    await waitFor(() => screen.getByText('Save'));

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/blog-roulette/blog-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('toggles between the editor and the live preview pane', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);
    await waitFor(() => screen.getByTestId('tinymce-editor'));

    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByText('Blog Preview')).toBeInTheDocument();
    expect(screen.queryByTestId('tinymce-editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Editor'));
    expect(screen.getByTestId('tinymce-editor')).toBeInTheDocument();
  });

  it('disables Submit until the pre-submit checklist passes', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);
    await waitFor(() => screen.getByText('Submit'));

    // Fresh draft with only 10 words and no tldr/meta fails checkpoints.
    expect(screen.getByText('Submit').closest('button')).toBeDisabled();
  });

  it('shows the rejected/locked banner with a cooldown message', async () => {
    global.fetch = fetchImpl({
      get: {
        ok: true,
        json: async () => ({
          blog: apiBlog({ status: 'REJECTED', updated_at: new Date().toISOString() }),
          tags: [],
        }),
      },
    });
    mockOrder.mockResolvedValue({ data: [] });

    render(<BlogEditPage />);
    await waitFor(() => {
      expect(screen.getByText('Blog Post Locked (Blind AI Rejection)')).toBeInTheDocument();
    });
  });

  it('allows unlocking a rejected post once the cooldown has passed (admin)', async () => {
    const longAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'priya.dhanani@creolestudios.com' } },
    });
    global.fetch = fetchImpl({
      get: {
        ok: true,
        json: async () => ({ blog: apiBlog({ status: 'REJECTED', updated_at: longAgo }), tags: [] }),
      },
    });
    mockOrder.mockResolvedValue({ data: [] });

    render(<BlogEditPage />);
    await waitFor(() => {
      expect(screen.getByText('Admin Override Unlock')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Admin Override Unlock'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/blog-roulette/blog-1/unlock',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('uploads a cover image and sets its URL', async () => {
    global.fetch = fetchImpl({});
    render(<BlogEditPage />);
    await waitFor(() => screen.getByText('Upload'));

    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    const uploadInput = screen.getByText('Upload').closest('label')!.querySelector('input[type="file"]')!;
    fireEvent.change(uploadInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://cdn.x/img.png')).toBeInTheDocument();
    });
  });
});

import PreviewPane from '@/components/blog-roulette/preview-pane';

describe('PreviewPane', () => {
  const baseProps = {
    html: '<p>Hello <strong>world</strong></p>',
    title: 'Blog Title',
    seoTitle: '',
    tldr: '',
    aiSignals: [] as string[],
    readingTime: 4,
  };

  it('shows the preview chrome, word count, and idle AI detection copy', () => {
    render(<PreviewPane {...baseProps} aiScore={null} />);

    expect(screen.getByText('Blog Preview')).toBeInTheDocument();
    expect(screen.getByText(/4 min read/)).toBeInTheDocument();
    expect(screen.getByText('2 words')).toBeInTheDocument();
    expect(screen.getByText(/AI detection not yet run/)).toBeInTheDocument();
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('renders safe, warn, and danger AI score bands', () => {
    const { rerender } = render(<PreviewPane {...baseProps} aiScore={25} />);
    expect(screen.getByText(/looks human-written/)).toBeInTheDocument();

    rerender(<PreviewPane {...baseProps} aiScore={65} />);
    expect(screen.getByText(/borderline, review suggested/)).toBeInTheDocument();

    rerender(<PreviewPane {...baseProps} aiScore={90} />);
    expect(screen.getByText(/likely AI-generated/)).toBeInTheDocument();
  });

  it('lists AI signals and SEO fallbacks', () => {
    render(
      <PreviewPane
        {...baseProps}
        aiScore={40}
        aiSignals={['Repetitive phrasing']}
        seoTitle="SEO Headline"
        tldr=""
      />,
    );

    expect(screen.getByText('Repetitive phrasing')).toBeInTheDocument();
    expect(screen.getByText('SEO Headline')).toBeInTheDocument();
    expect(screen.getByText('No TL;DR provided.')).toBeInTheDocument();
  });

  it('uses the blog title and TL;DR when SEO fields are provided', () => {
    render(
      <PreviewPane
        {...baseProps}
        aiScore={10}
        seoTitle=""
        tldr="A concise summary."
      />,
    );

    expect(screen.getByText('Blog Title')).toBeInTheDocument();
    expect(screen.getByText('A concise summary.')).toBeInTheDocument();
  });

  it('shows a placeholder when sanitized html is empty', () => {
    render(<PreviewPane {...baseProps} html="" aiScore={null} />);
    expect(screen.getByText('No content yet.')).toBeInTheDocument();
  });
});

import PublishedBlogView from '@/components/blog-roulette/published-blog-view';
import type { RouletteBlog } from '@/lib/blog-roulette/types';

function publishedBlog(overrides: Partial<RouletteBlog> = {}): RouletteBlog {
  return {
    id: 'blog-1',
    author_id: 'u1',
    title: 'Published Post',
    slug: 'published-post',
    body_html: '<p>Article body</p>',
    body_md: null,
    seo_title: 'SEO title',
    meta_description: 'Meta',
    cover_image_url: null,
    tldr: null,
    word_count: 120,
    reading_time: 6,
    ai_score: 20,
    status: 'PUBLISHED',
    submitted_at: null,
    published_at: '2026-08-01T00:00:00Z',
    drive_url: null,
    drive_file_id: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('PublishedBlogView', () => {
  it('renders published metadata, tags, cover image, and TL;DR', () => {
    render(
      <PublishedBlogView
        blog={publishedBlog({
          cover_image_url: 'https://cdn.example/cover.jpg',
          tldr: 'Quick summary',
        })}
        tags={['react', 'ai']}
      />,
    );

    expect(screen.getByText('Published Post')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Back to Roulette')).toBeInTheDocument();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('Quick summary')).toBeInTheDocument();
    expect(screen.getByAltText('Published Post')).toHaveAttribute('src', 'https://cdn.example/cover.jpg');
    expect(screen.getByText('Article body')).toBeInTheDocument();
    expect(screen.getByText('6 min read')).toBeInTheDocument();
    expect(screen.getByText('120 words')).toBeInTheDocument();
  });

  it('shows publishing and passed-quiz status labels', () => {
    const { rerender } = render(
      <PublishedBlogView blog={publishedBlog({ status: 'PUBLISHING' })} tags={[]} />,
    );
    expect(screen.getByText('Publishing')).toBeInTheDocument();

    rerender(<PublishedBlogView blog={publishedBlog({ status: 'PASSED' })} tags={[]} />);
    expect(screen.getByText('Passed Quiz')).toBeInTheDocument();
  });

  it('renders a placeholder when the body html is empty', () => {
    render(<PublishedBlogView blog={publishedBlog({ body_html: '' })} tags={[]} />);
    expect(screen.getByText('No content.')).toBeInTheDocument();
  });
});
