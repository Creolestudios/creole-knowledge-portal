'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Editor } from '@tinymce/tinymce-react';
import { motion } from 'motion/react';
import {
  Loader2,
  Save,
  Send,
  Sparkles,
  Tag as TagIcon,
  Image as ImageIcon,
  Eye,
  EyeOff,
  FileUp,
  Bot,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import PortalShell from '@/components/blog-roulette/portal-shell';
import ChecklistSidebar from '@/components/blog-roulette/checklist-sidebar';
import PreviewPane from '@/components/blog-roulette/preview-pane';
import PublishedBlogView from '@/components/blog-roulette/published-blog-view';
import {
  runCheckpoints,
  type CheckpointResult,
} from '@/lib/blog-roulette/validators';
import { BLOG_RULES, type RouletteBlog } from '@/lib/blog-roulette/types';
import { createClient } from '@/lib/supabase/client';

const TINY_API_KEY = process.env.NEXT_PUBLIC_TINYMCE_API_KEY ?? 'no-api-key';

export default function BlogEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [rejectionTime, setRejectionTime] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(0);

  const editorRef = useRef<{ getContent: () => string } | null>(null);
  const [blog, setBlog] = useState<RouletteBlog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [bodyHtml, setBodyHtml] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [metaDesc, setMetaDesc] = useState('');
  const [tldr, setTldr] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // AI detection state (null = not yet scanned)
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [aiSignals, setAiSignals] = useState<string[]>([]);
  const [aiDetecting, setAiDetecting] = useState(false);

  // Preview toggle
  const [showPreview, setShowPreview] = useState(false);

  // Debounce timer for AI detection
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load blog and user details
  useEffect(() => {
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        setUser({ id: authUser.id, email: authUser.email ?? undefined });
      }

      const res = await fetch(`/api/blog-roulette/${id}`);
      if (!res.ok) {
        router.push('/blog-roulette');
        return;
      }
      const data = await res.json();
      setBlog(data.blog);
      setBodyHtml(data.blog.body_html ?? '');
      setSeoTitle(data.blog.seo_title ?? data.blog.title?.slice(0, 60) ?? '');
      setMetaDesc(data.blog.meta_description ?? '');
      setTldr(data.blog.tldr ?? '');
      setCoverImageUrl(data.blog.cover_image_url ?? '');
      setTags(data.tags ?? []);

      // If blog is REJECTED, check for attempts to calculate cooldown
      if (data.blog.status === 'REJECTED') {
        const { data: attempts } = await supabase
          .from('roulette_quiz_attempts')
          .select('*')
          .eq('blog_id', id)
          .eq('result', 'REJECT')
          .order('completed_at', { ascending: false })
          .limit(1);

        if (attempts && attempts.length > 0) {
          setRejectionTime(attempts[0].completed_at);
        } else {
          setRejectionTime(data.blog.updated_at);
        }
      }

      setLoading(false);
    })();
  }, [id, router, supabase]);

  useEffect(() => {
    const t = setTimeout(() => {
      setNow(Date.now());
    }, 0);
    if (!rejectionTime || blog?.status !== 'REJECTED') return () => clearTimeout(t);
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [rejectionTime, blog]);

  async function handleUnlock() {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await fetch(`/api/blog-roulette/${id}/unlock`, {
        method: 'POST',
      });
      if (res.ok) {
        const { data: updatedBlog } = await supabase
          .from('roulette_blogs')
          .select('*')
          .eq('id', id)
          .single();
        if (updatedBlog) {
          setBlog(updatedBlog);
        } else {
          window.location.reload();
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setUnlockError(data.error ?? 'Unlock failed.');
      }
    } catch (err: any) {
      setUnlockError(err.message ?? 'Unlock failed.');
    } finally {
      setUnlocking(false);
    }
  }

  // Computed metrics
  const wordCount = useMemo(() => {
    const text = bodyHtml.replace(/<[^>]{1,10000}>/g, ' ');
    return text.trim().split(/\s+/).filter(Boolean).length;
  }, [bodyHtml]);

  const readingTime = Math.max(1, Math.round(wordCount / 200));

  const codeBlockCount = useMemo(
    () => (bodyHtml.match(/<pre[\s>]/gi) ?? []).length,
    [bodyHtml],
  );
  const diagramCount = useMemo(
    () =>
      (bodyHtml.match(/<img[\s>]|class="(?:mermaid|citation)"|<figure/gi) ?? [])
        .length,
    [bodyHtml],
  );

  const checkpoint: CheckpointResult = useMemo(
    () =>
      runCheckpoints({
        body_html: bodyHtml,
        word_count: wordCount,
        seo_title: seoTitle,
        meta_description: metaDesc,
        tldr,
        cover_image_url: coverImageUrl,
        ai_score: aiScore ?? 0,
        tags,
        code_block_count: codeBlockCount,
        diagram_count: diagramCount,
      }),
    [
      bodyHtml,
      wordCount,
      seoTitle,
      metaDesc,
      tldr,
      coverImageUrl,
      tags,
      codeBlockCount,
      diagramCount,
      aiScore,
    ],
  );

  // Autosave every 10s if dirty
  useEffect(() => {
    if (!blog || blog.status !== 'DRAFT') return;
    const t = setInterval(() => void save(true), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, seoTitle, metaDesc, tldr, coverImageUrl, tags, blog]);

  // AI detection — debounced 3s after content stops changing
  const runAiDetection = useCallback(async (html: string) => {
    if (html.length < 150) {
      setAiScore(0);
      setAiSignals(['Add more content for AI detection']);
      return;
    }
    setAiDetecting(true);
    try {
      const res = await fetch(`/api/blog-roulette/${id}/ai-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_html: html }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiScore(data.score);
        setAiSignals(data.signals ?? []);
      }
    } catch {
      // silently fail — keep last score
    } finally {
      setAiDetecting(false);
    }
  }, [id]);

  useEffect(() => {
    if (!blog || blog.status !== 'DRAFT') return;
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    aiTimerRef.current = setTimeout(() => {
      void runAiDetection(bodyHtml);
    }, 3000);
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, blog]);

  async function save(silent = false) {
    if (!blog) return;
    if (!silent) setSaving(true);
    try {
      await fetch(`/api/blog-roulette/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_html: bodyHtml,
          seo_title: seoTitle,
          meta_description: metaDesc,
          tldr,
          cover_image_url: coverImageUrl || undefined,
          word_count: wordCount,
          reading_time: readingTime,
          tags,
        }),
      });
    } finally {
      if (!silent) setSaving(false);
    }
  }

  function addTag() {
    const v = tagsInput.trim().toLowerCase();
    if (!v || tags.includes(v)) return;
    setTags([...tags, v]);
    setTagsInput('');
  }

  async function handleSubmit() {
    if (!checkpoint.passed) {
      alert('Pre-submit checklist not complete.');
      return;
    }
    setSubmitting(true);

    // Force an AI scan with the latest content so the DB has an accurate
    // score before the submit checkpoint reads it.
    await runAiDetection(bodyHtml);
    // Then save everything (includes the latest ai_score if the scan
    // persisted it — the scan runs in the background, so we also save
    // locally to be safe).
    await save();

    const res = await fetch(`/api/blog-roulette/${id}/submit`, {
      method: 'POST',
    });
    if (res.ok) {
      router.push(`/blog-roulette/${id}/quiz`);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? 'Submit failed.');
      setSubmitting(false);
    }
  }

  if (loading || !blog) {
    return (
      <PortalShell>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 text-brand animate-spin" />
        </div>
      </PortalShell>
    );
  }

  if (blog.status === 'PUBLISHED' || blog.status === 'PUBLISHING' || blog.status === 'PASSED') {
    return (
      <PortalShell userEmail={user?.email}>
        <PublishedBlogView blog={blog} tags={tags} />
      </PortalShell>
    );
  }

  const isLocked = blog.status !== 'DRAFT';
  const isAdmin = user?.email?.toLowerCase().trim() === 'priya.dhanani@creolestudios.com';

  let cooldownRemainingText: string | null = null;
  let canUnlockSelf = false;

  if (blog.status === 'REJECTED' && rejectionTime && now > 0) {
    const cooldownHours = BLOG_RULES.QUIZ_LOCKOUT_COOLDOWN_HOURS;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const elapsedMs = now - new Date(rejectionTime).getTime();
    const remainingMs = cooldownMs - elapsedMs;

    if (remainingMs <= 0) {
      cooldownRemainingText = null;
      canUnlockSelf = true;
    } else {
      const hrs = Math.floor(remainingMs / (60 * 60 * 1000));
      const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
      const secs = Math.floor((remainingMs % (60 * 1000)) / 1000);

      let text = '';
      if (hrs > 0) text += `${hrs}h `;
      if (mins > 0 || hrs > 0) text += `${mins}m `;
      text += `${secs}s`;
      cooldownRemainingText = text;
      canUnlockSelf = false;
    }
  }

  return (
    <PortalShell userEmail={user?.email}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
              <Sparkles size={10} />
              {isLocked ? 'Read Only' : 'Writing Mode'}
            </div>
            <h1 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight max-w-3xl">
              {blog.title}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="px-4 py-2.5 bg-white hover:bg-zinc-50 text-zinc-600 font-bold rounded-xl border border-zinc-200 shadow-sm transition-all flex items-center gap-2 text-sm"
              title={showPreview ? 'Show editor' : 'Preview blog'}
            >
              {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
              {showPreview ? 'Editor' : 'Preview'}
            </button>
            <button
              onClick={() => save(false)}
              disabled={saving || isLocked}
              className="px-5 py-2.5 bg-white hover:bg-zinc-50 text-zinc-700 font-bold rounded-xl border border-zinc-200 shadow-sm transition-all flex items-center gap-2 text-sm disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
            <button
              onClick={handleSubmit}
              disabled={!checkpoint.passed || submitting || isLocked}
              className="px-6 py-2.5 bg-brand hover:bg-brand-hover text-black font-black rounded-xl shadow-brand transition-all flex items-center gap-2 text-sm uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Submit
            </button>
          </div>
        </div>

        {blog.status === 'REJECTED' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-6 bg-red-50 border border-red-200 rounded-[28px] shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h2 className="text-lg font-black tracking-tight text-red-800">Blog Post Locked (Blind AI Rejection)</h2>
              </div>
              <p className="text-sm text-red-600 font-semibold max-w-2xl">
                This blog post was locked because of a low score or expired timer during the vetting quiz.
                {cooldownRemainingText ? (
                  <span> Cooldown active: you can unlock this post in <strong className="font-mono">{cooldownRemainingText}</strong> to try again.</span>
                ) : (
                  <span> Cooldown has expired. You can now unlock this post.</span>
                )}
              </p>
              {unlockError && (
                <p className="text-xs text-red-500 font-bold bg-white/80 p-2 rounded-lg border border-red-150 inline-block">
                  Error: {unlockError}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {isAdmin && (
                <button
                  onClick={handleUnlock}
                  disabled={unlocking}
                  className="px-5 py-3 bg-zinc-950 hover:bg-zinc-800 text-white font-black rounded-xl text-xs uppercase tracking-widest shadow-md transition-all flex items-center gap-2 cursor-pointer font-sans"
                >
                  {unlocking ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Sparkles size={12} className="text-brand" />
                  )}
                  Admin Override Unlock
                </button>
              )}

              <button
                onClick={handleUnlock}
                disabled={unlocking || (!canUnlockSelf && !isAdmin)}
                className={`px-5 py-3 font-black rounded-xl text-xs uppercase tracking-widest shadow-md transition-all flex items-center gap-2 ${canUnlockSelf || isAdmin
                    ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                    : 'bg-zinc-100 border border-zinc-200 text-zinc-400 cursor-not-allowed shadow-none'
                  }`}
              >
                {unlocking ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                Unlock Post
              </button>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Editor */}
          <div className="lg:col-span-3 space-y-6">
            {/* Meta block */}
            <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card space-y-5">
              <div>
                <label htmlFor="cover-image-url" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
                  Cover image URL
                </label>
                <div className="flex items-center gap-2">
                  <ImageIcon size={16} className="text-zinc-400 shrink-0" />
                  <input
                    id="cover-image-url"
                    value={coverImageUrl}
                    onChange={(e) => setCoverImageUrl(e.target.value)}
                    placeholder="https://..."
                    disabled={isLocked}
                    className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                  {!isLocked && (
                    <label className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-lg cursor-pointer transition-colors flex items-center gap-1.5 text-xs font-bold shrink-0">
                      <FileUp size={14} />
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const form = new FormData();
                          form.append('file', file);
                          try {
                            const res = await fetch('/api/blog-roulette/upload', {
                              method: 'POST',
                              body: form,
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setCoverImageUrl(data.url);
                            }
                          } catch { /* silent */ }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
                  SEO title ({seoTitle.length}/{BLOG_RULES.SEO_TITLE_MAX})
                </label>
                <input
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  maxLength={BLOG_RULES.SEO_TITLE_MAX}
                  disabled={isLocked}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
                  Meta description ({metaDesc.length}/{BLOG_RULES.META_DESC_MAX})
                </label>
                <textarea
                  value={metaDesc}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  maxLength={BLOG_RULES.META_DESC_MAX}
                  disabled={isLocked}
                  rows={2}
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
                  TL;DR (≤{BLOG_RULES.TLDR_MAX_WORDS} words)
                </label>
                <textarea
                  value={tldr}
                  onChange={(e) => setTldr(e.target.value)}
                  disabled={isLocked}
                  rows={3}
                  placeholder="Compress your thesis into 80 words or less."
                  className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
                  Tags (min {BLOG_RULES.MIN_TAGS})
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="px-3 py-1 bg-brand/10 border border-brand/20 text-brand text-xs font-bold rounded-lg flex items-center gap-1"
                    >
                      <TagIcon size={10} />
                      {t}
                      {!isLocked && (
                        <button
                          onClick={() =>
                            setTags(tags.filter((x) => x !== t))
                          }
                          className="ml-1 hover:text-red-500"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {!isLocked && (
                  <div className="flex gap-2">
                    <input
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                      placeholder="Type a tag and press Enter"
                      className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                    />
                    <button
                      onClick={addTag}
                      className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-lg"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* TinyMCE Editor / Preview Pane */}
            {showPreview ? (
              <PreviewPane
                html={bodyHtml}
                title={blog.title}
                seoTitle={seoTitle}
                tldr={tldr}
                aiScore={aiScore}
                aiSignals={aiSignals}
                readingTime={readingTime}
              />
            ) : (
              <div className="bg-white rounded-[28px] p-2 border border-zinc-100 shadow-card overflow-hidden">
                <Editor
                  apiKey={TINY_API_KEY}
                  onInit={(_evt, editor) => {
                    editorRef.current = editor;
                  }}
                  value={bodyHtml}
                  disabled={isLocked}
                  onEditorChange={(content) => setBodyHtml(content)}
                  init={{
                    height: 650,
                    menubar: 'edit view insert format tools',
                    plugins: [
                      'advlist',
                      'autolink',
                      'lists',
                      'link',
                      'image',
                      'charmap',
                      'preview',
                      'anchor',
                      'searchreplace',
                      'visualblocks',
                      'code',
                      'fullscreen',
                      'insertdatetime',
                      'media',
                      'table',
                      'wordcount',
                      'codesample',
                      'quickbars',
                    ],
                    toolbar:
                      'undo redo | blocks | bold italic underline strikethrough | bullist numlist | link image media codesample | removeformat | code fullscreen',
                    // --- Image upload: drag-and-drop / desktop file picker ---
                    // automatic_uploads is NOT set — URL images go straight in,
                    // only explicit uploads go through images_upload_handler.
                    file_picker_types: 'image image media',
                    image_title: true,
                    images_upload_handler: async (blobInfo) => {
                      const formData = new FormData();
                      formData.append('file', blobInfo.blob(), blobInfo.filename());
                      const res = await fetch('/api/blog-roulette/upload', {
                        method: 'POST',
                        body: formData,
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.error || 'Image upload failed');
                      }
                      const data = await res.json();
                      return data.url;
                    },
                    // Don't mangle external URLs
                    convert_urls: false,
                    // Allow full img attributes (src, alt, title, width, height, etc.)
                    extended_valid_elements:
                      'img[class|src|alt|title|width|height|loading|data-*]',
                    // --- Link defaults ---
                    link_default_target: '_blank',
                    link_context_toolbar: true,
                    // --- Quickbars (context toolbars on selection) ---
                    quickbars_insert_toolbar: 'image media codesample table',
                    quickbars_selection_toolbar: 'bold italic underline | bullist numlist | link h2 h3 blockquote',
                    quickbars_image_toolbar: 'alignleft aligncenter alignright | link image options',
                    codesample_languages: [
                      { text: 'TypeScript', value: 'typescript' },
                      { text: 'JavaScript', value: 'javascript' },
                      { text: 'Python', value: 'python' },
                      { text: 'Go', value: 'go' },
                      { text: 'Rust', value: 'rust' },
                      { text: 'SQL', value: 'sql' },
                      { text: 'Bash', value: 'bash' },
                      { text: 'JSON', value: 'json' },
                    ],
                    content_style: [
                      "body { font-family: Inter, system-ui, sans-serif; font-size:15px; line-height:1.7; color:#27272a; }",
                      "pre { background:#0f0f11 !important; color:#e4e4e7 !important; padding:20px !important; border-radius:12px !important; border:1px solid #27272a !important; font-size:13px !important; line-height:1.6 !important; overflow-x:auto !important; margin:24px 0 !important; }",
                      "pre code { background:transparent !important; color:inherit !important; padding:0 !important; font-family:'JetBrains Mono','Fira Code','Cascadia Code',monospace !important; font-size:13px !important; }",
                      "pre[class*='language-']::before { content:attr(class); display:block; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid #27272a; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#a1a1aa; }",
                      "code:not(pre code) { background:#f4f4f5; color:#a855f7; padding:2px 6px; border-radius:6px; font-size:13.5px; }",
                    ].join(' '),
                    branding: false,
                    promotion: false,
                  }}
                />
              </div>
            )}
          </div>

          {/* Sidebar — checklist */}
          <aside className="lg:col-span-1">
            <ChecklistSidebar result={checkpoint} />
            <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card mt-6">
              <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-3">
                Live Stats
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Words</span>
                  <span className="font-bold text-zinc-900">{wordCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Reading time</span>
                  <span className="font-bold text-zinc-900">
                    {readingTime} min
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Code blocks</span>
                  <span className="font-bold text-zinc-900">
                    {codeBlockCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Images / diagrams</span>
                  <span className="font-bold text-zinc-900">{diagramCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 flex items-center gap-1.5">
                    <Bot size={12} />
                    AI score
                    {aiDetecting && <Loader2 size={10} className="animate-spin text-brand" />}
                  </span>
                  <span
                    className={`font-bold text-xs px-2 py-0.5 rounded-lg ${aiScore === null
                        ? 'bg-zinc-100 text-zinc-400'
                        : aiScore >= 80
                          ? 'bg-red-50 text-red-600'
                          : aiScore >= 60
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-emerald-50 text-emerald-600'
                      }`}
                  >
                    {aiScore === null ? '—' : `${aiScore}%`}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}
