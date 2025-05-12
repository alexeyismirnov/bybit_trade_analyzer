// static/js/app.js

new Vue({
    el: '#app',
    delimiters: ['${', '}'], // Change Vue's delimiters to avoid conflict with Jinja2
    data: {
        trades: [],
        openTrades: [], // Added for open trades
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
        theme: 'light', // Added for theme selection
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
        
        // Settings Modal
        isSettingsModalVisible: false, // Control modal visibility with v-if
        selectedTimezone: 'UTC', // Default timezone
        timezones: [
            { label: 'UTC', value: 'UTC' },
            { label: 'GMT', value: 'GMT' },
            { label: 'America/New_York', value: 'America/New_York' },
            { label: 'America/Chicago', value: 'America/Chicago' },
            { label: 'America/Denver', value: 'America/Denver' },
            { label: 'America/Los_Angeles', value: 'America/Los_Angeles' },
            { label: 'Europe/London', value: 'Europe/London' },
            { label: 'Europe/Berlin', value: 'Europe/Berlin' },
            { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
            { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
            { label: 'Asia/Hong_Kong', value: 'Asia/Hong_Kong' },
            { label: 'Australia/Sydney', value: 'Australia/Sydney' }
            // Add more timezones as needed
        ]
    },
    computed: {
        // Filter completed trades by symbol
        symbolFilteredTrades() {
            if (!this.selectedSymbol) {
                return [...this.trades];
            }
            return this.trades.filter(trade => trade.symbol === this.selectedSymbol);
        },
        // Sort completed trades by timestamp (newest first for table)
        sortedTrades() {
            return [...this.symbolFilteredTrades].sort((a, b) =>
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
        }
    },
    mounted() {
        this.loadSettings(); // Load settings on mount
        this.fetchTrades();
        this.fetchOpenTrades(); // Fetch open trades on mount
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
            this.fetchOpenTrades(); // Fetch open trades when symbol changes
        },
        pageSize() {
            this.currentPage = 1;  // Reset to first page when changing page size
        },
        selectedTimezone() {
            // Re-render the trades table when timezone changes
            // No need to refetch data, just reformat the displayed time
            // The computed property `paginatedTrades` will automatically update
        }
    },
    watch: {
        // Watch for theme changes and apply the theme
        theme(newTheme) {
            this.applyTheme(newTheme);
        }
    },
    methods: {
        // Settings Modal methods
        showSettingsModal() {
            this.isSettingsModalVisible = true; // Show the modal
            // Use Bootstrap's modal API
            // Wait for the modal to be added to the DOM by v-if
            this.$nextTick(() => {
                const settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));
                settingsModal.show();
                // Add event listener to reset isSettingsModalVisible when modal is hidden
                document.getElementById('settingsModal').addEventListener('hidden.bs.modal', this.hideSettingsModal);
            });
        },
        saveSettings() {
            // Save selected timezone and theme to localStorage
            localStorage.setItem('selectedTimezone', this.selectedTimezone);
            localStorage.setItem('theme', this.theme); // Save theme
            // Close the modal
            const settingsModal = bootstrap.Modal.getInstance(document.getElementById('settingsModal'));
            settingsModal.hide();
            // The hideSettingsModal method will be called by the event listener
        },
        hideSettingsModal() {
            this.isSettingsModalVisible = false; // Hide the modal after Bootstrap animation
            // Remove the event listener
            document.getElementById('settingsModal').removeEventListener('hidden.bs.modal', this.hideSettingsModal);
        },
        loadSettings() {
            // Load selected timezone and theme from localStorage
            const savedTimezone = localStorage.getItem('selectedTimezone');
            if (savedTimezone) {
                this.selectedTimezone = savedTimezone;
            }
            const savedTheme = localStorage.getItem('theme'); // Load theme
            if (savedTheme) {
                this.theme = savedTheme;
            }
            // Apply the theme on load
            this.applyTheme(this.theme);
        },
        // Method to apply the selected theme
        applyTheme(theme) {
            const body = document.body;
            if (theme === 'dark') {
                body.classList.add('dark-mode');
            } else {
                body.classList.remove('dark-mode');
            }
        },

        // New method to format timestamp based on selected timezone
        formatTimestamp(timestampMs) {
            if (!timestampMs) return '-';
            // Use Luxon to format the timestamp
            return luxon.DateTime.fromMillis(parseInt(timestampMs)).setZone(this.selectedTimezone).toFormat('yyyy-MM-dd HH:mm:ss');
        },

        // New method to format symbol with direction arrow for completed trades
        formatSymbolWithDirection(trade) {
            // If side is 'Sell', it means we closed a LONG position (green, arrow up)
            // Otherwise, it was a SHORT position (red, arrow down)
            if (trade.side === 'Sell') {
                return '<i class="bi bi-caret-up-fill"></i> ' + trade.symbol;
            } else {
                return '<i class="bi bi-caret-down-fill"></i> ' + trade.symbol;
            }
        },
        
        // New method to get the class for symbol direction for completed trades
        getSymbolDirectionClass(trade) {
            return trade.side === 'Sell' ? 'positive' : 'negative';
        },
        
        // New method to format open trade symbol with direction arrow
        formatOpenTradeSymbol(trade) {
            // For open trades, "Buy" means LONG position (green, arrow up)
            // "Sell" means SHORT position (red, arrow down)
            if (trade.side === 'Buy') {
                return '<i class="bi bi-caret-up-fill"></i> ' + trade.symbol;
            } else {
                return '<i class="bi bi-caret-down-fill"></i> ' + trade.symbol;
            }
        },
        
        // New method to get the class for open trade symbol direction
        getOpenTradeDirectionClass(trade) {
            return trade.side === 'Buy' ? 'positive' : 'negative';
        },
        
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
                        
                        // Extract unique symbols from both completed and open trades
                        const completedSymbols = this.trades.map(trade => trade.symbol);
                        const openSymbols = this.openTrades.map(trade => trade.symbol);
                        this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
                        
                        this.calculateSummary();
                        this.updateCharts();
                        
                        // Log performance
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
                        
                        // Update unique symbols with open trades
                        const completedSymbols = this.trades.map(trade => trade.symbol);
                        const openSymbols = this.openTrades.map(trade => trade.symbol);
                        this.uniqueSymbols = [...new Set([...completedSymbols, ...openSymbols])];
                        
                        // Log performance
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
            
            // Calculate total PnL for completed trades
            this.totalPnl = trades.reduce((sum, trade) => {
                return sum + parseFloat(trade.closed_pnl || 0);
            }, 0);
            
            // Calculate average ROI for completed trades
            const totalRoi = trades.reduce((sum, trade) => {
                return sum + (trade.roi || 0);
            }, 0);
            
            this.averageRoi = trades.length > 0 ? totalRoi / trades.length : 0;
            
            // Set rates from distribution for completed trades
            this.winRate = distribution.winRate;
            this.drawRate = distribution.drawRate;
            this.lossRate = distribution.lossRate;
        },
        updateCharts() {
            // Get time unit based on selected period
            const timeUnit = ChartManager.getTimeUnit(this.selectedTimePeriod);
            
            // Create/update the PnL chart using completed trades, passing the current theme
            ChartManager.createPnlChart('pnlChart', this.symbolFilteredTrades, timeUnit, this.theme);
            
            // Create/update the distribution chart using completed trades, passing the current theme
            ChartManager.createDistributionChart('distributionChart', this.tradeDistribution, this.theme);
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

            // Apply appropriate class based on value (for PnL)
            return numValue >= 0 ? 'positive' : 'negative';
        },
        // New method to get the class for ROI values
        getRoiClass(value) {
            // Explicitly handle all cases to ensure proper coloring
            if (value === undefined || value === null) return '';

            // Convert to number to ensure proper comparison
            const numValue = parseFloat(value);

            // Handle NaN case
            if (isNaN(numValue)) return '';

            // Apply appropriate class based on value (for ROI)
            return numValue >= 0 ? 'positive' : 'negative';
        },
        // Formatting for open trades
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