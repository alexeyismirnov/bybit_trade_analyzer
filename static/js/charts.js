// static/js/charts.js

// Chart manager object to handle all chart-related functionality
const ChartManager = {
    // Store chart instances
    charts: {},
    
    // Initialize or update a chart
    createOrUpdateChart(chartId, type, data, options) {
        // Destroy existing chart if it exists
        this.destroyChart(chartId);
        
        const ctx = document.getElementById(chartId);
        if (!ctx) {
            console.error(`Canvas element with ID ${chartId} not found`);
            return null;
        }
        
        // Create new chart
        this.charts[chartId] = new Chart(ctx, {
            type: type,
            data: data,
            options: options
        });
        
        return this.charts[chartId];
    },
    
    // Destroy a specific chart
    destroyChart(chartId) {
        if (this.charts[chartId]) {
            this.charts[chartId].destroy();
            delete this.charts[chartId];
        }
    },
    
    // Destroy all charts
    destroyAllCharts() {
        Object.keys(this.charts).forEach(chartId => {
            this.destroyChart(chartId);
        });
    },
    
    // Show "No data" message on a chart canvas
    showNoDataMessage(chartId, message = 'No trade data available') {
        const ctx = document.getElementById(chartId);
        if (!ctx) {
            console.error(`Canvas element with ID ${chartId} not found`);
            return;
        }
        
        const ctx2d = ctx.getContext('2d');
        ctx2d.clearRect(0, 0, ctx.width, ctx.height);
        ctx2d.font = '16px Arial';
        ctx2d.fillStyle = '#666';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(message, ctx.width / 2, ctx.height / 2);
    },
    
    // Create PnL chart
    createPnlChart(chartId, trades, timeUnit) {
        // Sort trades by timestamp (oldest first)
        const sortedTrades = [...trades].sort((a, b) => 
            parseInt(a.created_at) - parseInt(b.created_at)
        );
        
        // Calculate cumulative PnL
        let cumulativePnl = 0;
        const chartData = sortedTrades.map(trade => {
            cumulativePnl += parseFloat(trade.closed_pnl || 0);
            return {
                x: new Date(parseInt(trade.created_at) * 1000),
                y: cumulativePnl
            };
        });
        
        // Only create chart if we have data
        if (chartData.length === 0) {
            this.showNoDataMessage(chartId);
            return null;
        }
        
        // Chart configuration
        const data = {
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
        };
        
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: timeUnit
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
        };
        
        return this.createOrUpdateChart(chartId, 'line', data, options);
    },
    
    // Create distribution pie chart
    createDistributionChart(chartId, distribution) {
        // Only create chart if we have data
        if (distribution.wins + distribution.losses + distribution.draws === 0) {
            this.showNoDataMessage(chartId);
            return null;
        }
        
        // Chart configuration
        const data = {
            labels: ['Wins', 'Losses', 'Draws'],
            datasets: [{
                data: [distribution.wins, distribution.losses, distribution.draws],
                backgroundColor: [
                    'rgba(75, 192, 75, 0.7)',  // Green for wins
                    'rgba(255, 99, 132, 0.7)', // Red for losses
                    'rgba(150, 150, 150, 0.7)' // Grey for draws
                ],
                borderColor: [
                    'rgba(75, 192, 75, 1)',
                    'rgba(255, 99, 132, 1)',
                    'rgba(150, 150, 150, 1)'
                ],
                borderWidth: 1
            }]
        };
        
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                },
                title: {
                    display: true,
                    text: 'Trade Performance',
                    font: {
                        size: 16
                    }
                }
            }
        };
        
        return this.createOrUpdateChart(chartId, 'pie', data, options);
    },
    
    // Helper function to determine appropriate time unit
    getTimeUnit(days) {
        // Choose appropriate time unit based on selected period
        const daysNum = parseInt(days);
        if (daysNum <= 7) return 'day';
        if (daysNum <= 90) return 'week';
        return 'month';
    }
};

// Export the chart manager
window.ChartManager = ChartManager;