import { notFound } from 'next/navigation';
import PreviewDashboard from '@/components/dashboard/PreviewDashboard';

/**
 * Auth-free demo of the user dashboard for showing the frontend without a
 * login. Renders the mock-data `DashboardShell`. Disabled in production so it
 * never ships as a public, unauthenticated view of the app.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PreviewDashboard />;
}
