new Vue({
    el: '#app',
    data: {
        trades: [],
        loading: false,
        error: null,
        totalPnl: 0,
        averageRoi: 0,
        winRate: 0,
        selectedSymbol: '',
        selectedTimePeriod: '30',  // Default to 30 days
        pnlChart: null,
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
        pageSizeOptions: [10, 25, 50, 100]
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
        // For chart data, we need all trades sorted by time (oldest first)
        chartTrades() {
            return [...this.symbolFilteredTrades].sort((a, b) => 
                parseInt(a.created_at) - parseInt(b.created_at)
            );
        }
    },
    mounted() {
        this.fetchTrades();
    },
    watch: {
        selectedSymbol() {
            this.currentPage = 1;  // Reset to first page when changing symbol
            this.calculateSummary();
            this.updateChart();
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
            
            // Build the URL with query parameters
            let url = '/api/trades?days=' + this.selectedTimePeriod;
            if (this.selectedSymbol) {
                url += `&symbol=${this.selectedSymbol}`;
            }
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        
                        // Extract unique symbols
                        this.uniqueSymbols = [...new Set(this.trades.map(trade => trade.symbol))];
                        
                        this.calculateSummary();
                        this.initChart();
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
            
            // Calculate total PnL
            this.totalPnl = trades.reduce((sum, trade) => {
                return sum + parseFloat(trade.closed_pnl || 0);
            }, 0);
            
            // Calculate average ROI
            const totalRoi = trades.reduce((sum, trade) => {
                return sum + (trade.roi || 0);
            }, 0);
            
            this.averageRoi = trades.length > 0 ? totalRoi / trades.length : 0;
            
            // Calculate win rate
            const winningTrades = trades.filter(trade => parseFloat(trade.closed_pnl) > 0).length;
            this.winRate = trades.length > 0 ? ((winningTrades / trades.length) * 100).toFixed(2) : 0;
        },
        initChart() {
            // Make sure to properly destroy the existing chart before creating a new one
            if (this.pnlChart) {
                this.pnlChart.destroy();
                this.pnlChart = null;
            }
            
            // Create a new chart
            this.updateChart();
        },
        updateChart() {
            // Make sure to properly destroy the existing chart before updating
            if (this.pnlChart) {
                this.pnlChart.destroy();
                this.pnlChart = null;
            }
            
            const ctx = document.getElementById('pnlChart');
            if (!ctx) {
                console.error('Canvas element not found');
                return;
            }
            
            // Use chartTrades (oldest first for chart)
            const tradesToChart = this.chartTrades;
            
            // Calculate cumulative PnL
            let cumulativePnl = 0;
            const chartData = tradesToChart.map(trade => {
                cumulativePnl += parseFloat(trade.closed_pnl || 0);
                return {
                    x: new Date(parseInt(trade.created_at) * 1000),
                    y: cumulativePnl
                };
            });
            
            // Only create chart if we have data
            if (chartData.length > 0) {
                // Create the chart
                this.pnlChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        datasets: [{
                            label: 'Cumulative PnL',
                            data: chartData,
                            borderColor: 'rgb(75, 192, 192)',
                            tension: 0.1,
                            fill: {
                                target: 'origin',
                                above: 'rgba(75, 192, 192, 0.2)',
                                below: 'rgba(255, 99, 132, 0.2)'
                            }
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                type: 'time',
                                time: {
                                    unit: this.getTimeUnit(this.selectedTimePeriod)
                                },
                                title: {
                                    display: true,
                                    text: 'Date'
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Cumulative PnL'
                                }
                            }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return `PnL: ${context.parsed.y.toFixed(4)}`;
                                    }
                                }
                            }
                        }
                    }
                });
            } else {
                // Display a message if no data
                const ctx2d = ctx.getContext('2d');
                ctx2d.clearRect(0, 0, ctx.width, ctx.height);
                ctx2d.font = '16px Arial';
                ctx2d.fillStyle = '#666';
                ctx2d.textAlign = 'center';
                ctx2d.fillText('No trade data available', ctx.width / 2, ctx.height / 2);
            }
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
        getTimeUnit(days) {
            // Choose appropriate time unit based on selected period
            const daysNum = parseInt(days);
            if (daysNum <= 7) return 'day';
            if (daysNum <= 90) return 'week';
            return 'month';
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
            if (!value) return '';
            return parseFloat(value) >= 0 ? 'positive' : 'negative';
        }
    }
});