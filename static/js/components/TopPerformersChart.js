// static/js/components/TopPerformersChart.js
Vue.component('top-performers-chart', {
    delimiters: ['${', '}'],
    template: `
        <div class="chart-container">
            <canvas ref="chartCanvas" height="300"></canvas>
            <div v-if="noData" class="text-center py-5 no-data-message">
                <p>No coins with positive PnL in this period</p>
            </div>
        </div>
    `,
    props: {
        topCoins: {
            type: Array,
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
            // Calculate total PnL for top coins
            const totalPnL = this.topCoins.reduce((sum, coin) => sum + coin.pnl, 0);

            // Check if we have data and total PnL is positive
            if (this.topCoins.length === 0 || totalPnL <= 0) {
                this.noData = true;
                return null;
            }
            
            this.noData = false;
            
            // Extract labels (symbols without USDT) and data (PnL values)
            const labels = this.topCoins.map(coin => coin.symbol.replace(/USDT$/, '')); // Remove USDT postfix
            const dataValues = this.topCoins.map(coin => coin.pnl);

            // Chart configuration
            return {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: dataValues,
                        backgroundColor: [
                            'rgba(75, 192, 75, 0.7)',  // Green
                            'rgba(54, 162, 235, 0.7)', // Blue
                            'rgba(255, 206, 86, 0.7)', // Yellow
                            'rgba(153, 102, 255, 0.7)', // Purple
                            'rgba(255, 159, 64, 0.7)'  // Orange
                        ],
                        borderColor: [
                            'rgba(75, 192, 75, 1)',
                            'rgba(54, 162, 235, 1)',
                            'rgba(255, 206, 86, 1)',
                            'rgba(153, 102, 255, 1)',
                            'rgba(255, 159, 64, 1)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: this.theme === 'dark' ? '#fff' : '#000'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    const percentage = ((value / totalPnL) * 100).toFixed(2);
                                    return `${label}: ${value.toFixed(4)} (${percentage}%)`;
                                }
                            }
                        },
                        title: {
                            display: false
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
            ctx.fillText('No coins with positive PnL in this period', displayWidth / 2, displayHeight / 2);
        }
    },
    watch: {
        topCoins: {
            handler() {
                if (this.topCoins.length === 0) {
                    this.showNoDataMessage();
                } else {
                    this.$nextTick(() => {
                        this.initChart();
                    });
                }
            },
            deep: true
        },
        theme() {
            this.$nextTick(() => {
                if (this.topCoins.length === 0 || this.topCoins.reduce((sum, coin) => sum + coin.pnl, 0) <= 0) {
                    this.showNoDataMessage();
                } else {
                    this.initChart();
                }
            });
        }
    },
    mounted() {
        if (this.topCoins.length === 0) {
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