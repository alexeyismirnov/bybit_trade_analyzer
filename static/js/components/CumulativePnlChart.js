// static/js/components/CumulativePnlChart.js
Vue.component('cumulative-pnl-chart', {
    delimiters: ['${', '}'],
    template: `
        <div class="chart-container">
            <canvas ref="chartCanvas" height="300"></canvas>
            <div v-if="noData" class="text-center py-5 no-data-message">
                <p>No trade data available</p>
            </div>
        </div>
    `,
    props: {
        trades: {
            type: Array,
            required: true
        },
        timeUnit: {
            type: String,
            required: true
        },
        theme: {
            type: String,
            default: 'light'
        }
    },
    data() {
        return {
            chart: null,
            noData: false
        };
    },
    computed: {
        chartConfiguration() {
            // Sort trades by timestamp (oldest first)
            const sortedTrades = [...this.trades].sort((a, b) =>
                parseInt(a.created_at) - parseInt(b.created_at)
            );

            const isDarkMode = this.theme === 'dark';
            const textColor = isDarkMode ? '#fff' : '#000';
            const gridColor = isDarkMode ? 'rgba(0, 170, 0, 0.3)' : '#e0e0e0';
            const borderColor = isDarkMode ? 'rgb(0, 255, 0)' : 'rgb(75, 192, 192)';
            const aboveColor = isDarkMode ? 'rgba(0, 255, 0, 0.5)' : 'rgba(144, 238, 144, 0.5)';
            const belowColor = isDarkMode ? 'rgba(255, 0, 0, 0.5)' : 'rgba(255, 99, 132, 0.5)';
            
            // Calculate cumulative PnL
            let cumulativePnl = 0;
            const chartData = sortedTrades.map(trade => {
                cumulativePnl += parseFloat(trade.closed_pnl || 0);
                return {
                    x: new Date(parseInt(trade.created_at) * 1000),
                    y: cumulativePnl
                };
            });
            
            // Check if we have data
            if (chartData.length === 0) {
                this.noData = true;
                return null;
            }
            
            this.noData = false;
            
            // Chart configuration
            return {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Cumulative PnL',
                        data: chartData,
                        borderColor: borderColor,
                        tension: 0.1,
                        fill: {
                            target: 'origin',
                            above: aboveColor,
                            below: belowColor
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
                                unit: this.timeUnit
                            },
                            title: {
                                display: true,
                                text: 'Date',
                                color: textColor
                            },
                            ticks: {
                                color: textColor
                            },
                            grid: {
                                color: gridColor
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Cumulative PnL',
                                color: textColor
                            },
                            ticks: {
                                color: textColor
                            },
                            grid: {
                                color: gridColor
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `PnL: ${context.parsed.y.toFixed(4)}`;
                                }
                            }
                        }
                    }
                }
            };
        }
    },
    methods: {
        initChart() {
            // Destroy existing chart if it exists
            if (this.chart) {
                this.chart.destroy();
            }
            
            // If no data or configuration, show no data message
            if (!this.chartConfiguration) {
                return;
            }
            
            // Create new chart
            const ctx = this.$refs.chartCanvas.getContext('2d');
            this.chart = new Chart(ctx, this.chartConfiguration);
        },
        showNoDataMessage() {
            // If there's an existing chart, destroy it
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            
            const canvas = this.$refs.chartCanvas;
            if (!canvas) return;
            
            const ctx = canvas.getContext('2d');
            
            // Clear the canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Set text styling
            ctx.font = '14px Arial';
            ctx.fillStyle = this.theme === 'dark' ? '#fff' : '#666';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Get actual canvas dimensions
            const displayWidth = canvas.clientWidth || canvas.width || 300;
            const displayHeight = canvas.clientHeight || canvas.height || 200;
            
            // Set canvas dimensions if they're not already set
            if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
                canvas.width = displayWidth;
                canvas.height = displayHeight;
            }
            
            // Draw the text in the center of the canvas
            ctx.fillText('No trade data available', displayWidth / 2, displayHeight / 2);
        }
    },
    watch: {
        trades: {
            handler() {
                if (this.trades.length === 0) {
                    this.showNoDataMessage();
                } else {
                    this.$nextTick(() => {
                        this.initChart();
                    });
                }
            },
            deep: true
        },
        timeUnit() {
            this.$nextTick(() => {
                this.initChart();
            });
        },
        theme() {
            this.$nextTick(() => {
                if (this.trades.length === 0) {
                    this.showNoDataMessage();
                } else {
                    this.initChart();
                }
            });
        }
    },
    mounted() {
        if (this.trades.length === 0) {
            this.showNoDataMessage();
        } else {
            this.$nextTick(() => {
                this.initChart();
            });
        }
    },
    beforeDestroy() {
        if (this.chart) {
            this.chart.destroy();
        }
    }
});