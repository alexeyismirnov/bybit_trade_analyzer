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
    createPnlChart(chartId, trades, timeUnit, theme) {
        // Sort trades by timestamp (oldest first)
        const sortedTrades = [...trades].sort((a, b) =>
            parseInt(a.created_at) - parseInt(b.created_at)
        );

        const isDarkMode = theme === 'dark';
        const textColor = isDarkMode ? '#fff' : '#000'; // White for dark mode text, Black for light mode text
        const gridColor = isDarkMode ? 'rgba(0, 170, 0, 0.3)' : '#e0e0e0'; // Subtle green grid for dark mode
        const borderColor = isDarkMode ? 'rgb(0, 255, 0)' : 'rgb(75, 192, 192)'; // Brighter green line for dark mode
        const aboveColor = isDarkMode ? 'rgba(0, 255, 0, 0.5)' : 'rgba(144, 238, 144, 0.5)'; // Light green fill above for light mode (salad color), more opaque
        const belowColor = isDarkMode ? 'rgba(255, 0, 0, 0.5)' : 'rgba(255, 99, 132, 0.5)'; // Red fill below for dark mode
        
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
                borderColor: borderColor,
                tension: 0.1,
                fill: {
                    target: 'origin',
                    above: aboveColor,
                    below: belowColor
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
                        text: 'Date',
                        color: textColor // Set title color
                    },
                    ticks: {
                        color: textColor // Set tick color
                    },
                    grid: {
                        color: gridColor // Set grid color
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Cumulative PnL',
                        color: textColor // Set title color
                    },
                    ticks: {
                        color: textColor // Set tick color
                    },
                    grid: {
                        color: gridColor // Set grid color
                    }
                }
            },
            plugins: {
                legend: {
                    display: false  // Hide the legend
                },
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
    
    // Create pie chart for top performing coins
    createDistributionChart(chartId, topCoins, theme) {
        // Calculate total PnL for top coins
        const totalPnL = topCoins.reduce((sum, coin) => sum + coin.pnl, 0);

        // Only create chart if we have data and total PnL is positive
        if (topCoins.length === 0 || totalPnL <= 0) {
            this.showNoDataMessage(chartId, 'No coins with positive PnL in this period');
            return null;
        }
        
        // Extract labels (symbols without USDT) and data (PnL values)
        const labels = topCoins.map(coin => coin.symbol.replace(/USDT$/, '')); // Remove USDT postfix
        const dataValues = topCoins.map(coin => coin.pnl);

        // Chart configuration
        const data = {
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
        };

        const options = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: theme === 'dark' ? '#fff' : '#000' // Set legend text color (White for dark, Black for light)
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const percentage = ((value / totalPnL) * 100).toFixed(2); // Calculate percentage based on totalPnL
                            return `${label}: ${value.toFixed(4)} (${percentage}%)`; // Display PnL with 4 decimal places
                        }
                    }
                },
                title: {
                    display: false, // Hide the Chart.js built-in title
                    text: 'Top performers', // New title text
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