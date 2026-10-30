import type {NextConfig} from 'next';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion', 'lucide-react'],
  outputFileTracingRoot: process.cwd(),
  async redirects() {
    return [
      {
        source: '/admin/zoho',
        destination: '/admin/dashboard?tab=zoho',
        permanent: false,
      },
      {
        source: '/admin/zoho-evaluation',
        destination: '/admin/dashboard?tab=zoho',
        permanent: false,
      },
      {
        source: '/admin/ai-interview',
        destination: '/admin/dashboard?tab=ai-interviews',
        permanent: false,
      },
      {
        source: '/admin/ai-interviews',
        destination: '/admin/dashboard?tab=ai-interviews',
        permanent: false,
      },
      {
        source: '/admin/users',
        destination: '/admin/dashboard?tab=users',
        permanent: false,
      },
      {
        source: '/admin/submissions',
        destination: '/admin/dashboard?tab=submissions',
        permanent: false,
      },
      {
        source: '/admin/sources',
        destination: '/admin/dashboard?tab=sources',
        permanent: false,
      },
    ];
  },
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
