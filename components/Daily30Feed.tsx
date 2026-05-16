import { Daily30Item } from '@/lib/curation/daily-30';

interface Daily30FeedProps {
  items: Daily30Item[];
}

export default function Daily30Feed({ items }: Daily30FeedProps) {
  if (!items || items.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">No curated items available for today.</div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">The Daily 30</h2>
      <p className="text-gray-600 mb-8">Curated technical reading for your morning coffee.</p>

      {items.map((item) => (
        <article
          key={item.id}
          className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex justify-between items-start mb-2">
            <span className="text-sm font-semibold text-blue-600 uppercase tracking-wider">
              {item.blogs.source}
            </span>
            <span className="text-sm text-gray-500">
              {new Date(item.blogs.published_at).toLocaleDateString()}
            </span>
          </div>

          <h3 className="text-xl font-semibold mb-3">
            <a
              href={item.blogs.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-600 transition-colors"
            >
              {item.blogs.title}
            </a>
          </h3>

          {item.curation_notes && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-yellow-800">
              <strong>Curator Note:</strong> {item.curation_notes}
            </div>
          )}

          <p className="text-gray-700 mb-4 line-clamp-3">{item.blogs.summary}</p>

          <div className="flex flex-wrap gap-2 mt-4">
            {item.blogs.tags?.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
              >
                {tag}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
