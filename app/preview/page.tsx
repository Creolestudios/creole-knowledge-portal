import { notFound } from 'next/navigation';

/** Unauthenticated demo preview is disabled — the dashboard uses real users only. */
export default function PreviewPage() {
  notFound();
}
