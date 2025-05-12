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
        totalPnl: 0,
        averageRoi: 0,
        winRate: 0,
        drawRate: 0,
        lossRate: 0,
        selectedSymbol: '',
        selectedTimePeriod: '30',  // Default to 30 days
        uniqueSymbols: [],
        theme: 'light',
        hideSmallTrades: true,
        timePeriods: [
            { label: '7D', value: '7' },
            { label: '30D', value: '30' },
            { label: '90D', value: '90' },
            { label: '180D', value: '180' },
            { label: '1Y', value: '365' }
        ],
        // Pagination for completed trades
        currentPage: 1,
        pageSize: 10,
        pageSizeOptions: [10, 25, 50, 100],
        // Cache indicator
        usingCachedData: false,
        lastUpdated: null,
        
        // Settings Modal - simplified, component will handle most of this
        isSettingsModalVisible: false,
        selectedTimezone: 'UTC', // Default timezone
    },
    computed: {
        // Filter completed trades by symbol
        symbolFilteredTrades() {
            if (!this.selectedSymbol) {
                return [...this.trades];
            }
            return this.trades.filter(trade => trade.symbol === this.selectedSymbol);
        },
        // Filter completed trades by PnL if hideSmallTrades is true
        filteredTradesByPnL() {
            if (this.hideSmallTrades) {
                return this.symbolFilteredTrades.filter(trade => {
                    const pnl = parseFloat(trade.closed_pnl || 0);
                    return pnl >= 0.1 || pnl <= -0.1; // Keep trades with PnL >= 0.1 or PnL <= -0.1
                });
            }
            return this.symbolFilteredTrades;
        },
        // Sort completed trades by timestamp (newest first for table)
        sortedTrades() {
            return [...this.filteredTradesByPnL].sort((a, b) =>
                parseInt(b.created_at) - parseInt(a.created_at)
            );
        },
        // Get current page of completed trades
        paginatedTrades() {
            const startIndex = (this.currentPage - 1) * this.pageSize;
            return this.sortedTrades.slice(startIndex, startIndex + this.pageSize);
        },
        // Calculate total number of pages for completed trades
        totalPages() {
            return Math.ceil(this.sortedTrades.length / this.pageSize);
        },
        // Generate page numbers array for completed trades pagination controls
        pageNumbers() {
            const pages = [];
            const maxVisiblePages = 5;
            
            if (this.totalPages <= maxVisiblePages) {
                // If we have fewer pages than our max, show all pages
                for (let i = 1; i <= this.totalPages; i++) {
                    pages.push(i);
                }
            } else {
                // Always include first page
                pages.push(1);
                
                // Calculate start and end of visible page range
                let start = Math.max(2, this.currentPage - 1);
                let end = Math.min(this.totalPages - 1, this.currentPage + 1);
                
                // Adjust start and end to always show 3 pages
                if (start === 2) end = Math.min(4, this.totalPages - 1);
                if (end === this.totalPages - 1) start = Math.max(2, this.totalPages - 3);
                
                // Add ellipsis if needed
                if (start > 2) pages.push('...');
                
                // Add visible page numbers
                for (let i = start; i <= end; i++) {
                    pages.push(i);
                }
                
                // Add ellipsis if needed
                if (end < this.totalPages - 1) pages.push('...');
                
                // Always include last page
                pages.push(this.totalPages);
            }
            
            return pages;
        },
        // Calculate trade distribution data for completed trades
        tradeDistribution() {
            const trades = this.symbolFilteredTrades;
            let wins = 0, losses = 0, draws = 0;
            
            trades.forEach(trade => {
                const roi = parseFloat(trade.roi || 0);
                if (Math.abs(roi) < 1) {
                    draws++;
                } else if (roi >= 1) {
                    wins++;
                } else {
                    losses++;
                }
            });
            
            const total = trades.length;
            return {
                wins,
                losses,
                draws,
                winRate: total > 0 ? (wins / total * 100).toFixed(2) : 0,
                lossRate: total > 0 ? (losses / total * 100).toFixed(2) : 0,
                drawRate: total > 0 ? (draws / total * 100).toFixed(2) : 0
            };
        },
        // Format the last updated timestamp
        formattedLastUpdated() {
            if (!this.lastUpdated) return '';
            
            const date = new Date(this.lastUpdated);
            return date.toLocaleString();
        },
        // Filter open trades by symbol
        symbolFilteredOpenTrades() {
            if (!this.selectedSymbol) {
                return [...this.openTrades];
            }
            return this.openTrades.filter(trade => trade.symbol === this.selectedSymbol);
        },
        // Sort open trades by updatedTime (newest first for table)
        sortedOpenTrades() {
            return [...this.symbolFilteredOpenTrades].sort((a, b) =>
                parseInt(b.updatedTime) - parseInt(a.updatedTime)
            );
        },
        // Calculate total unrealized PnL for open trades
        totalUnrealisedPnl() {
            return this.symbolFilteredOpenTrades.reduce((sum, trade) => {
                return sum + parseFloat(trade.unrealisedPnl || 0);
            }, 0);
        },
        // Calculate top 5 performing coins by PnL (positive PnL only)
        topPerformingCoins() {
            const pnlBySymbol = {};
            this.symbolFilteredTrades.forEach(trade => {
                const symbol = trade.symbol;
                const pnl = parseFloat(trade.closed_pnl || 0);
                if (pnlBySymbol[symbol]) {
                    pnlBySymbol[symbol] += pnl;
                } else {
                    pnlBySymbol[symbol] = pnl;
                }
            });

            // Convert to array, filter for positive PnL, sort, and take top 5
            const sortedCoins = Object.keys(pnlBySymbol)
                .map(symbol => ({ symbol, pnl: pnlBySymbol[symbol] }))
                .filter(coin => coin.pnl > 0)
                .sort((a, b) => b.pnl - a.pnl)
                .slice(0, 5);

            return sortedCoins;
        }
    },
    mounted() {
        this.loadSettings();
        this.fetchTrades();
        this.fetchOpenTrades();
    },
    beforeDestroy() {
        // Clean up charts when component is destroyed
        ChartManager.destroyAllCharts();
    },
    watch: {
        selectedSymbol() {
            this.currentPage = 1;  // Reset to first page when changing symbol
            this.updateCharts();
            this.calculateSummary();
        },
        pageSize() {
            this.currentPage = 1;  // Reset to first page when changing page size
        },
        selectedTimezone() {
            // Re-render the trades table when timezone changes
            // No need to refetch data, just reformat the displayed time
        },
        theme(newTheme) {
            this.applyTheme(newTheme);
            this.updateCharts(); // Redraw charts with new theme colors
        }
    },
    methods: {
        // Settings Modal methods - simplified to work with component
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
            this.loadHideSmallTradesPreference();
        },
        saveHideSmallTradesPreference() {
            localStorage.setItem('hideSmallTrades', this.hideSmallTrades);
        },
        loadHideSmallTradesPreference() {
            const savedPreference = localStorage.getItem('hideSmallTrades');
            if (savedPreference !== null) {
                this.hideSmallTrades = JSON.parse(savedPreference);
            }
        },
        applyTheme(theme) {
            const body = document.body;
            if (theme === 'dark') {
                body.classList.add('dark-mode');
            } else {
                body.classList.remove('dark-mode');
            }
        },
        formatTimestamp(timestampMs) {
            if (!timestampMs) return '-';
            return luxon.DateTime.fromMillis(parseInt(timestampMs)).setZone(this.selectedTimezone).toFormat('yyyy-MM-dd HH:mm:ss');
        },
        formatSymbolWithDirection(trade) {
            if (trade.side === 'Sell') {
                return '<i class="bi bi-caret-up-fill"></i> ' + trade.symbol;
            } else {
                return '<i class="bi bi-caret-down-fill"></i> ' + trade.symbol;
            }
        },
        getSymbolDirectionClass(trade) {
            return trade.side === 'Sell' ? 'positive' : 'negative';
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
                this.currentPage = 1;
                this.fetchTrades();
            }
        },
        fetchTrades() {
            this.loading = true;
            this.error = null;
            this.usingCachedData = false;
            
            let url = '/api/trades?days=' + this.selectedTimePeriod;
            if (this.selectedSymbol) {
                url += `&symbol=${this.selectedSymbol}`;
            }
            
            url += '&cache_check=true';
            
            const startTime = performance.now();
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        
                        this.usingCachedData = response.data.from_cache === true;
                        this.lastUpdated = response.data.cached_at || new Date().toISOString();
                        
                        const completedSymbols = this.trades.map(trade => trade.symbol);
                        const openSymbols = this.openTrades.map(trade => trade.symbol);
                        this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
                        
                        this.calculateSummary();
                        this.updateCharts();
                        
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
            
            let url = '/api/open-trades';
            if (this.selectedSymbol) {
                url += `?symbol=${this.selectedSymbol}`;
            }
            
            const startTime = performance.now();
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.openTrades = response.data.open_trades;
                        
                        const completedSymbols = this.trades.map(trade => trade.symbol);
                        const openSymbols = this.openTrades.map(trade => trade.symbol);
                        this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
                        
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
        calculateSummary() {
            const trades = this.sortedTrades;
            const distribution = this.tradeDistribution;
            
            this.totalPnl = trades.reduce((sum, trade) => {
                return sum + parseFloat(trade.closed_pnl || 0);
            }, 0);
            
            const totalRoi = trades.reduce((sum, trade) => {
                return sum + (trade.roi || 0);
            }, 0);
            
            this.averageRoi = trades.length > 0 ? totalRoi / trades.length : 0;
            
            this.winRate = distribution.winRate;
            this.drawRate = distribution.drawRate;
            this.lossRate = distribution.lossRate;
        },
        updateCharts() {
            const timeUnit = ChartManager.getTimeUnit(this.selectedTimePeriod);
            ChartManager.createPnlChart('pnlChart', this.symbolFilteredTrades, timeUnit, this.theme);
            ChartManager.createDistributionChart('distributionChart', this.topPerformingCoins, this.theme);
        },
        changePage(page) {
            if (page === '...' || page < 1 || page > this.totalPages) return;
            this.currentPage = page;
        },
        previousPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
            }
        },
        nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
            }
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
        }
    }
});