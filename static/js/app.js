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
        pnlChart: null,
        uniqueSymbols: []
    },
    computed: {
        filteredTrades() {
            if (!this.selectedSymbol) {
                return this.trades;
            }
            return this.trades.filter(trade => trade.symbol === this.selectedSymbol);
        }
    },
    mounted() {
        this.fetchTrades();
    },
    watch: {
        selectedSymbol() {
            this.calculateSummary();
            this.updateChart();
        }
    },
    methods: {
        fetchTrades() {
            this.loading = true;
            this.error = null;
            
            let url = '/api/trades';
            if (this.selectedSymbol) {
                url += `?symbol=${this.selectedSymbol}`;
            }
            
            axios.get(url)
                .then(response => {
                    if (response.data.success) {
                        this.trades = response.data.trades;
                        
                        // Extract unique symbols
                        this.uniqueSymbols = [...new Set(this.trades.map(trade => trade.symbol))];
                        
                        // Sort trades by date (oldest first) for the chart
                        this.trades.sort((a, b) => {
                            return parseInt(a.created_at) - parseInt(b.created_at);
                        });
                        
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
            const trades = this.filteredTrades;
            
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
            
            // Sort trades by date (oldest first)
            const tradesToChart = [...this.filteredTrades].sort((a, b) => {
                return parseInt(a.created_at) - parseInt(b.created_at);
            });
            
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
                                    unit: 'day'
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
                ctx2d.font = '16px Arial';
                ctx2d.fillStyle = '#666';
                ctx2d.textAlign = 'center';
                ctx2d.fillText('No trade data available', ctx.width / 2, ctx.height / 2);
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
            if (!value) return '';
            return parseFloat(value) >= 0 ? 'positive' : 'negative';
        }
    }
});