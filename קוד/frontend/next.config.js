/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // כותרת HTTP בכל עמוד שמורה למנועי החיפוש לא לאנדקס את האתר.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
