'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Editor } from '@tinymce/tinymce-react';
import {
  Loader2,
  Save,
  Send,
  Sparkles,
  Tag as TagIcon,
  Image as ImageIcon,
} from 'lucide-react';
import PortalShell from '@/components/blog-roulette/portal-shell';
import ChecklistSidebar from '@/components/blog-roulette/checklist-sidebar';
import {
  runCheckpoints,
  type CheckpointResult,
} from '@/lib/blog-roulette/validators';
import { BLOG_RULES, type RouletteBlog } from '@/lib/blog-roulette/types';

const TINY_API_KEY = process.env.NEXT_PUBLIC_TINYMCE_API_KEY ?? 'no-api-key';

export default function BlogEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

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

  // Load blog
  useEffect(() => {
    (async () => {
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
      setLoading(false);
    })();
  }, [id, router]);

  // Computed metrics
  const wordCount = useMemo(() => {
    const text = bodyHtml.replace(/<[^>]+>/g, ' ');
    return text.trim().split(/\s+/).filter(Boolean).length;
  }, [bodyHtml]);

  const readingTime = Math.max(1, Math.round(wordCount / 200));

  const codeBlockCount = useMemo(
    () => (bodyHtml.match(/<pre[\s>]|<code[\s>]/gi) ?? []).length,
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
        ai_score: 30, // placeholder until AI score endpoint wired
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
    ],
  );

  // Autosave every 10s if dirty
  useEffect(() => {
    if (!blog || blog.status !== 'DRAFT') return;
    const t = setInterval(() => void save(true), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHtml, seoTitle, metaDesc, tldr, coverImageUrl, tags, blog]);

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

  const isLocked = blog.status !== 'DRAFT';

  return (
    <PortalShell>
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Editor */}
          <div className="lg:col-span-3 space-y-6">
            {/* Meta block */}
            <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card space-y-5">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">
                  Cover image URL
                </label>
                <div className="flex items-center gap-2">
                  <ImageIcon size={16} className="text-zinc-400" />
                  <input
                    value={coverImageUrl}
                    onChange={(e) => setCoverImageUrl(e.target.value)}
                    placeholder="https://..."
                    disabled={isLocked}
                    className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
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

            {/* TinyMCE Editor */}
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
                  ],
                  toolbar:
                    'undo redo | blocks | bold italic underline | bullist numlist | link image media codesample | removeformat | code',
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
                  content_style:
                    "body { font-family: Inter, sans-serif; font-size:15px; line-height:1.7; color:#27272a; } pre { background:#0f0f11; color:#e4e4e7; padding:16px; border-radius:12px; }",
                  branding: false,
                  promotion: false,
                }}
              />
            </div>
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
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}
