const CACHE_NAME = 'redflow-strategy-cache-v1';
const urlsToCache = [
  '/',
  '/static/css/dashboard.css',
  '/static/css/login.css',
  '/static/js/app.js',
  '/static/js/components/CompletedTradesTable.js',
  '/static/js/components/CumulativePnlChart.js',
  '/static/js/components/NavBar.js',
  '/static/js/components/OpenTradesTable.js',
  '/static/js/components/PerformanceCharts.js',
  '/static/js/components/SettingsModal.js',
  '/static/js/components/TopPerformersChart.js',
  '/static/manifest.json',
  // Add other static assets like images if needed
  // '/static/images/bybit_login.png',
  // '/static/images/bybit_trades_bg2.png',
  // Add external libraries if you want to cache them (e.g., Bootstrap, Vue, Chart.js)
  'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.js',
  'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js',
  'https://cdn.jsdelivr.net/npm/luxon@2.0.2/build/global/luxon.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon@1.0.0/dist/chartjs-adapter-luxon.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.8.1/font/bootstrap-icons.css',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap&display=swap', // Duplicate, should fix
  'https://fonts.gstatic.com/s/orbitron/v25/yMJgRMzzdPv-e_BsgCQmNC3P_Q.woff2', // Example font file
  'https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js' // Babel for components
];

// Install event: Cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache.map(url => {
            // Handle relative URLs for Flask's url_for
            if (url.startsWith('/static/')) {
                return url; // Assuming Flask serves static files directly
            }
            return url;
        }));
      })
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event: Serve from cache or network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        // No cache match - fetch from network
        return fetch(event.request);
      })
  );
});