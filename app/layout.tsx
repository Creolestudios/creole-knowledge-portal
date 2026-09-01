import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Creole Knowledge Portal',
  description: 'Personalized morning blog recommendations for office teams.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var url = window.location;
                if (url.hostname.includes('.elb.amazonaws.com')) {
                  window.location.replace('https://dxad42dnfuckt.cloudfront.net' + url.pathname + url.search + url.hash);
                  return;
                }
                if (url.hostname.includes('.run.app') && url.port && url.port !== '443') {
                  window.location.replace(url.protocol + '//' + url.hostname + url.pathname + url.search + url.hash);
                }
                if (typeof window !== 'undefined' && window.fetch) {
                  var origFetch = window.fetch;
                  window.fetch = function(resource, init) {
                    if (typeof resource === 'string' && resource.startsWith('/api/')) {
                      var isPortal = window.location.pathname.startsWith('/creole-knowledge-portal');
                      if (isPortal) {
                        resource = '/creole-knowledge-portal' + resource;
                      }
                    }
                    return origFetch.call(this, resource, init);
                  };
                }
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
