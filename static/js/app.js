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
        symbolFilteredOpenTrades() {
            // Always return all open trades - no filtering by symbol
            return [...this.openTrades];
        },
        sortedOpenTrades() {
            return [...this.symbolFilteredOpenTrades].sort((a, b) =>
                parseInt(b.updatedTime) - parseInt(a.updatedTime)
            );
        },
        totalUnrealisedPnl() {
            return this.symbolFilteredOpenTrades.reduce((sum, trade) => {
                return sum + parseFloat(trade.unrealisedPnl || 0);
            }, 0);
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
    beforeDestroy() {
        ChartManager.destroyAllCharts();
    },
    watch: {
        selectedTimezone() {
            // The CompletedTradesTable component will react to this prop change
        },
        theme(newTheme) {
            this.applyTheme(newTheme);
            this.updateCharts(); // Redraw charts with new theme colors
        },
        trades() {
             const completedSymbols = this.trades.map(trade => trade.symbol);
             const openSymbols = this.openTrades.map(trade => trade.symbol);
             this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
             this.updateCharts();
        },
        openTrades() {
             const completedSymbols = this.trades.map(trade => trade.symbol);
             const openSymbols = this.openTrades.map(trade => trade.symbol);
             this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
        },
        selectedSymbol() {
            // When selectedSymbol changes at the app level, update the charts and fetch open trades
            this.updateCharts();
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
            this.applyTheme(settings.theme);
            this.updateCharts(); // Redraw charts with new theme colors
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
        formatOpenTradeSymbol(trade) {
            if (trade.side === 'Buy') {
                return '<i class="bi bi-caret-up-fill"></i> ' + trade.symbol;
            } else {
                return '<i class="bi bi-caret-down-fill"></i> ' + trade.symbol;
            }
        },
        getOpenTradeDirectionClass(trade) {
            return trade.side === 'Buy' ? 'positive' : 'negative';
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
            
            const startTime = performance.now();
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        
                        this.usingCachedData = response.data.from_cache === true;
                        this.lastUpdated = response.data.cached_at || new Date().toISOString();
                        
                        const endTime = performance.now();
                        console.log(`Completed trades data fetched in ${(endTime - startTime).toFixed(2)}ms (${this.usingCachedData ? 'from cache' : 'from API'})`);
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
        const url = '/api/open-trades';
        
        const startTime = performance.now();
        
        axios.get(url)
            .then(response => {
                if (response.data.success) {
                    this.openTrades = response.data.open_trades;
                    
                    const endTime = performance.now();
                    console.log(`Open trades data fetched in ${(endTime - startTime).toFixed(2)}ms`);
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
        updateCharts() {
            const timeUnit = ChartManager.getTimeUnit(this.selectedTimePeriod);
            
            // Use the filteredTrades computed property
            ChartManager.createPnlChart('pnlChart', this.filteredTrades, timeUnit, this.theme);
            ChartManager.createDistributionChart('distributionChart', this.topPerformingCoins, this.theme);
        },
        formatPrice(price) {
            if (!price) return '-';
            return parseFloat(price).toFixed(2);
        },
        formatPnl(pnl) {
            if (!pnl) return '-';
            return parseFloat(pnl).toFixed(4);
        },
        formatRoi(roi) {
            if (!roi && roi !== 0) return '-';
            return parseFloat(roi).toFixed(2) + '%';
        },
        getPnlClass(value) {
            if (value === undefined || value === null) return '';
            const numValue = parseFloat(value);
            if (isNaN(numValue)) return '';
            return numValue >= 0 ? 'positive' : 'negative';
        },
        getRoiClass(value) {
            if (value === undefined || value === null) return '';
            const numValue = parseFloat(value);
            if (isNaN(numValue)) return '';
            return numValue >= 0 ? 'positive' : 'negative';
        },
        formatUnrealisedPnl(pnl) {
            if (!pnl) return '-';
            return parseFloat(pnl).toFixed(4);
        },
        getUnrealisedPnlClass(pnl) {
            if (pnl === undefined || pnl === null) return '';
            const numPnl = parseFloat(pnl);
            if (isNaN(numPnl)) return '';
            return numPnl >= 0 ? 'positive' : 'negative';
        },
        handleCompletedTradesSymbolChange(symbol) {
            this.selectedSymbol = symbol;
        }
    }
});