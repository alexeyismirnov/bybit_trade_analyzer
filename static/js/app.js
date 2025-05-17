// static/js/app.js

// Add an Axios interceptor to handle unauthorized responses
axios.interceptors.response.use(response => {
    return response;
}, error => {
    if (error.response && error.response.status === 401) {
        // Redirect to login page if unauthorized
        window.location.href = '/';
    }
    return Promise.reject(error);
});

new Vue({
    el: '#app',
    delimiters: ['${', '}'], // Change Vue's delimiters to avoid conflict with Jinja2
    data: {
        trades: [],
        openTrades: [],
        loading: false,
        error: null,
        selectedTimePeriod: '30',  // Default to 30 days
        uniqueSymbols: [],
        theme: 'light',
        selectedSymbol: '', // Add this back to track the selected symbol at the app level
        selectedExchange: 'bybit', // Default to bybit
        timePeriods: [
            { label: '7D', value: '7' },
            { label: '30D', value: '30' },
            { label: '90D', value: '90' },
            { label: '180D', value: '180' },
            { label: '1Y', value: '365' }
        ],
        usingCachedData: false,
        lastUpdated: null,
        
        // Settings Modal
        isSettingsModalVisible: false,
        selectedTimezone: 'UTC', // Default timezone
    },
    computed: {
        formattedLastUpdated() {
            if (!this.lastUpdated) return '';
            
            const date = new Date(this.lastUpdated);
            return date.toLocaleString();
        },
        filteredTrades() {
            // Filter trades based on selected symbol
            if (this.selectedSymbol) {
                return this.trades.filter(trade => trade.symbol === this.selectedSymbol);
            }
            return this.trades;
        },
        topPerformingCoins() {
            // If a symbol is selected, only include that symbol
            if (this.selectedSymbol) {
                // Get all trades for the selected symbol
                const filteredTrades = this.trades.filter(trade => trade.symbol === this.selectedSymbol);
                
                // Calculate total PnL for this symbol
                const totalPnl = filteredTrades.reduce((sum, trade) => sum + parseFloat(trade.closed_pnl || 0), 0);
                
                // Only include the symbol if it has positive PnL
                if (totalPnl > 0) {
                    return [{ symbol: this.selectedSymbol, pnl: totalPnl }];
                } else {
                    return []; // Return empty array if no positive PnL
                }
            } else {
                // Original logic for all symbols
                const pnlBySymbol = {};
                this.trades.forEach(trade => {
                    const symbol = trade.symbol;
                    const pnl = parseFloat(trade.closed_pnl || 0);
                    if (pnlBySymbol[symbol]) {
                        pnlBySymbol[symbol] += pnl;
                    } else {
                        pnlBySymbol[symbol] = pnl;
                    }
                });

                const sortedCoins = Object.keys(pnlBySymbol)
                    .map(symbol => ({ symbol, pnl: pnlBySymbol[symbol] }))
                    .filter(coin => coin.pnl > 0)
                    .sort((a, b) => b.pnl - a.pnl)
                    .slice(0, 5);

                return sortedCoins;
            }
        }
    },
    mounted() {
        this.loadSettings();
        this.fetchTrades();
        this.fetchOpenTrades();
    },
    watch: {
        selectedTimezone() {
            // The CompletedTradesTable component will react to this prop change
        },
        theme(newTheme) {
            this.applyTheme(newTheme);
        },
        trades() {
             const completedSymbols = this.trades.map(trade => trade.symbol);
             const openSymbols = this.openTrades.map(trade => trade.symbol);
             this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
        },
        openTrades() {
             const completedSymbols = this.trades.map(trade => trade.symbol);
             const openSymbols = this.openTrades.map(trade => trade.symbol);
             this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
        }
    },
    methods: {
        showSettingsModal() {
            this.isSettingsModalVisible = true;
        },
        hideSettingsModal() {
            this.isSettingsModalVisible = false;
        },
        onSettingsSaved(settings) {
            this.selectedTimezone = settings.timezone;
            this.theme = settings.theme;
            
            // Handle exchange change
            const exchangeChanged = this.selectedExchange !== settings.exchange;
            this.selectedExchange = settings.exchange;
            
            this.applyTheme(settings.theme);
            
            // If exchange changed, reset selected symbol and refetch data
            if (exchangeChanged) {
                this.selectedSymbol = '';
                this.fetchTrades();
                this.fetchOpenTrades();
            }
        },
        loadSettings() {
            const savedTimezone = localStorage.getItem('selectedTimezone');
            if (savedTimezone) {
                this.selectedTimezone = savedTimezone;
            }
            
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                this.theme = savedTheme;
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                this.theme = 'dark';
            } else {
                this.theme = 'light';
            }
            
            const savedExchange = localStorage.getItem('selectedExchange');
            if (savedExchange) {
                this.selectedExchange = savedExchange;
            }
            
            this.applyTheme(this.theme);
        },
        applyTheme(theme) {
            const body = document.body;
            if (theme === 'dark') {
                body.classList.add('dark-mode');
            } else {
                body.classList.remove('dark-mode');
            }
        },
        setTimePeriod(days) {
            if (this.selectedTimePeriod !== days) {
                this.selectedTimePeriod = days;
                this.fetchTrades();
            }
        },
        fetchTrades() {
            this.loading = true;
            this.error = null;
            this.usingCachedData = false;
            
            let url = '/api/trades?days=' + this.selectedTimePeriod;
            url += '&cache_check=true';
            url += '&exchange=' + this.selectedExchange;
            
            if (this.selectedSymbol) {
                url += '&symbol=' + this.selectedSymbol;
            }
            
            const startTime = performance.now();
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        
                        this.usingCachedData = response.data.from_cache === true;
                        this.lastUpdated = response.data.cached_at || new Date().toISOString();
                        
                        const endTime = performance.now();
                        console.log(`Completed trades data fetched in ${(endTime - startTime).toFixed(2)}ms (${this.usingCachedData ? 'from cache' : 'from API'}) for ${this.selectedExchange}`);
                    } else {
                        this.error = response.data.error || 'Failed to fetch completed trades';
                    }
                })
                .catch(error => {
                    this.error = error.message || 'An error occurred while fetching completed trades';
                })
                .finally(() => {
                    this.loading = false;
                });
        },
        fetchOpenTrades() {
            this.loading = true;
            this.error = null;
            
            // Always fetch all open trades without any symbol filtering
            let url = '/api/open-trades';
            url += '?exchange=' + this.selectedExchange;
            
            if (this.selectedSymbol) {
                url += '&symbol=' + this.selectedSymbol;
            }
            
            const startTime = performance.now();
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.openTrades = response.data.open_trades;
                        
                        const endTime = performance.now();
                        console.log(`Open trades data fetched in ${(endTime - startTime).toFixed(2)}ms for ${this.selectedExchange}`);
                    } else {
                        this.error = response.data.error || 'Failed to fetch open trades';
                    }
                })
                .catch(error => {
                    this.error = error.message || 'An error occurred while fetching open trades';
                })
                .finally(() => {
                    this.loading = false;
                });
        },
        handleCompletedTradesSymbolChange(symbol) {
            this.selectedSymbol = symbol;
        },
        handleCloseTrade(trade) {
            console.log('Attempting to close trade:', trade);
            // Implement API call to close the trade
            axios.post('/api/close-trade', {
                symbol: trade.symbol,
                exchange: trade.exchange,
                trade_data: trade // Sending the whole trade object for now
            })
            .then(response => {
                if (response.data.success) {
                    console.log('Trade closed successfully:', response.data);
                    // Refresh trades after successful closure
                    this.fetchOpenTrades();
                    this.fetchTrades();
                    
                } else {
                    console.error('Failed to close trade:', response.data.error);
                    // Show an error message to the user
                    this.error = response.data.error || 'Failed to close trade';
                }
            })
            .catch(error => {
                console.error('Error closing trade:', error);
                // Show a generic error message
                this.error = 'An error occurred while closing the trade.';
            });
        }
    }
});

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    });
}