// static/js/app.js

new Vue({
    el: '#app',
    data: {
        trades: [],
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
        timePeriods: [
            { label: '7D', value: '7' },
            { label: '30D', value: '30' },
            { label: '90D', value: '90' },
            { label: '180D', value: '180' },
            { label: '1Y', value: '365' }
        ],
        // Pagination
        currentPage: 1,
        pageSize: 10,
        pageSizeOptions: [10, 25, 50, 100],
        // Cache indicator
        usingCachedData: false,
        lastUpdated: null
    },
    computed: {
        // Filter trades by symbol
        symbolFilteredTrades() {
            if (!this.selectedSymbol) {
                return [...this.trades];
            }
            return this.trades.filter(trade => trade.symbol === this.selectedSymbol);
        },
        // Sort by timestamp (newest first for table)
        sortedTrades() {
            return [...this.symbolFilteredTrades].sort((a, b) => 
                parseInt(b.created_at) - parseInt(a.created_at)
            );
        },
        // Get current page of trades
        paginatedTrades() {
            const startIndex = (this.currentPage - 1) * this.pageSize;
            return this.sortedTrades.slice(startIndex, startIndex + this.pageSize);
        },
        // Calculate total number of pages
        totalPages() {
            return Math.ceil(this.sortedTrades.length / this.pageSize);
        },
        // Generate page numbers array for pagination controls
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
        // Calculate trade distribution data
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
            }
        },
    mounted() {
        this.fetchTrades();
        },
    beforeDestroy() {
        // Clean up charts when component is destroyed
        ChartManager.destroyAllCharts();
        },
    watch: {
        selectedSymbol() {
            this.currentPage = 1;  // Reset to first page when changing symbol
            this.calculateSummary();
            this.updateCharts();
        },
        pageSize() {
            this.currentPage = 1;  // Reset to first page when changing page size
            }
        },
    methods: {
        setTimePeriod(days) {
            if (this.selectedTimePeriod !== days) {
                this.selectedTimePeriod = days;
                this.currentPage = 1;  // Reset to first page when changing time period
                this.fetchTrades();
            }
        },
        fetchTrades() {
            this.loading = true;
            this.error = null;
            this.usingCachedData = false;
            
            // Build the URL with query parameters
            let url = '/api/trades?days=' + this.selectedTimePeriod;
            if (this.selectedSymbol) {
                url += `&symbol=${this.selectedSymbol}`;
            }
            
            // Add cache parameter to track if data comes from cache
            url += '&cache_check=true';
            
            const startTime = performance.now();
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        
                        // Check if data was from cache
                        this.usingCachedData = response.data.from_cache === true;
                        this.lastUpdated = response.data.cached_at || new Date().toISOString();
                        
                        // Extract unique symbols
                        this.uniqueSymbols = [...new Set(this.trades.map(trade => trade.symbol))];
                        
                        this.calculateSummary();
                        this.updateCharts();
                        
                        // Log performance
                        const endTime = performance.now();
                        console.log(`Data fetched in ${(endTime - startTime).toFixed(2)}ms (${this.usingCachedData ? 'from cache' : 'from API'})`);
                    } else {
                        this.error = response.data.error || 'Failed to fetch trades';
        }
                })
                .catch(error => {
                    this.error = error.message || 'An error occurred while fetching trades';
                })
                .finally(() => {
                    this.loading = false;
});
        },
        refreshData() {
            // Force refresh from API by adding a timestamp to avoid cache
            this.loading = true;
            this.error = null;
            
            // Build the URL with query parameters
            let url = '/api/trades?days=' + this.selectedTimePeriod;
            if (this.selectedSymbol) {
                url += `&symbol=${this.selectedSymbol}`;
            }
            
            // Add force_refresh parameter
            url += `&force_refresh=true&_t=${new Date().getTime()}`;
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        this.usingCachedData = false;
                        this.lastUpdated = new Date().toISOString();
                        
                        // Extract unique symbols
                        this.uniqueSymbols = [...new Set(this.trades.map(trade => trade.symbol))];
                        
                        this.calculateSummary();
                        this.updateCharts();
                    } else {
                        this.error = response.data.error || 'Failed to fetch trades';
                    }
                })
                .catch(error => {
                    this.error = error.message || 'An error occurred while fetching trades';
                })
                .finally(() => {
                    this.loading = false;
                });
        },
        calculateSummary() {
            const trades = this.sortedTrades;
            const distribution = this.tradeDistribution;
            
            // Calculate total PnL
            this.totalPnl = trades.reduce((sum, trade) => {
                return sum + parseFloat(trade.closed_pnl || 0);
            }, 0);
            
            // Calculate average ROI
            const totalRoi = trades.reduce((sum, trade) => {
                return sum + (trade.roi || 0);
            }, 0);
            
            this.averageRoi = trades.length > 0 ? totalRoi / trades.length : 0;
            
            // Set rates from distribution
            this.winRate = distribution.winRate;
            this.drawRate = distribution.drawRate;
            this.lossRate = distribution.lossRate;
        },
        updateCharts() {
            // Get time unit based on selected period
            const timeUnit = ChartManager.getTimeUnit(this.selectedTimePeriod);
            
            // Create/update the PnL chart
            ChartManager.createPnlChart('pnlChart', this.symbolFilteredTrades, timeUnit);
            
            // Create/update the distribution chart
            ChartManager.createDistributionChart('distributionChart', this.tradeDistribution);
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
            // Explicitly handle all cases to ensure proper coloring
            if (value === undefined || value === null) return '';
            
            // Convert to number to ensure proper comparison
            const numValue = parseFloat(value);
            
            // Handle NaN case
            if (isNaN(numValue)) return '';
            
            // For ROI, consider less than 1% (absolute) as a draw
            if (Math.abs(numValue) < 1) return '';
            
            // Apply appropriate class based on value
            return numValue >= 1 ? 'positive' : (numValue <= -1 ? 'negative' : '');
        }
    }
});