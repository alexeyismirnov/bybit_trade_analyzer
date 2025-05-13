// static/js/components/CompletedTradesTable.js
Vue.component('completed-trades-table', {
    delimiters: ['${', '}'], // Match the main app's delimiters
    template: `
 <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0 matrix-header">Completed Trades</h5>
                <div class="d-flex align-items-center">
                    <!-- Hide small trades switch -->
                    <div class="form-check form-switch me-3">
                        <input class="form-check-input" type="checkbox" id="hideSmallTradesSwitch" v-model="hideSmallTrades" @change="saveHideSmallTradesPreference">
                        <label class="form-check-label" for="hideSmallTradesSwitch">Hide small trades</label>
                    </div>
                    <!-- Changed v-model to use localSelectedSymbol instead of selectedSymbol -->
                    <select v-model="localSelectedSymbol" class="form-select form-select-sm d-inline-block" style="width: auto;">
                        <option value="">All Pairs</option>
                        <option v-for="symbol in uniqueSymbols" :key="symbol" :value="symbol">\${ symbol }</option>
                    </select>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead class="header-row">
                            <tr>
                                <th>Symbol</th>
                                <!-- Side column removed -->
                                <th>Quantity</th>
                                <th>PnL</th>
                                <th>ROI (%)</th>
                                <th>Date/Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="trade in paginatedTrades" :key="trade.id">
                                <!-- Updated Symbol column with direction indicator -->
                                <td :class="getSymbolDirectionClass(trade)">
                                    <span v-html="formatSymbolWithDirection(trade)"></span>
                                </td>
                                <td>\${ trade.qty }</td>
                                <td :class="getPnlClass(trade.closed_pnl)">\${ formatPnl(trade.closed_pnl) }</td>
                                <td :class="getRoiClass(trade.roi)">\${ formatRoi(trade.roi) }</td>
                                <td>\${ formatTimestamp(trade.updatedTime) }</td>
                            </tr>
                            <tr v-if="paginatedTrades.length === 0">
                                <td colspan="5" class="text-center">No trades found</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <!-- Pagination Controls -->
                <div class="d-flex justify-content-between align-items-center mt-3" v-if="sortedTrades.length > 0">
                    <div class="pagination-info">
                        Showing \${ (currentPage - 1) * pageSize + 1 } to \${ Math.min(currentPage * pageSize, sortedTrades.length) } of \${ sortedTrades.length } trades
                    </div>
                    
                    <div class="d-flex align-items-center">
                        <select v-model="pageSize" class="form-select form-select-sm me-3" style="width: auto;">
                            <option v-for="size in pageSizeOptions" :key="size" :value="size">\${ size } per page</option>
                        </select>
                        
                        <nav aria-label="Trades pagination">
                            <ul class="pagination pagination-sm mb-0">
                                <li class="page-item">
                                    <a class="page-link" href="#" @click.prevent="previousPage" :class="{ disabled: currentPage === 1 }">
                                        &laquo;
                                    </a>
                                </li>
                                <li class="page-item" v-for="page in pageNumbers" :key="page">
                                    <a class="page-link" href="#" 
                                       @click.prevent="changePage(page)"
                                       :class="{ active: page === currentPage, disabled: page === '...' }">
                                        \${ page }
                                    </a>
                                </li>
                                <li class="page-item">
                                    <a class="page-link" href="#" @click.prevent="nextPage" :class="{ disabled: currentPage === totalPages }">
                                        &raquo;
                                    </a>
                                </li>
                            </ul>
                        </nav>
                    </div>
                </div>
            </div>
            <div class="card-footer" v-if="sortedTrades.length > 0">
                <div class="row">
                    <div class="col-md-2">
                        <strong>Total Trades:</strong> \${ sortedTrades.length }
                    </div>
                    <div class="col-md-3">
                        <strong>Total PnL:</strong> 
                        <span :class="getPnlClass(totalPnl)">\${ formatPnl(totalPnl) }</span>
                    </div>
                    <div class="col-md-2">
                        <strong>Avg ROI:</strong> 
                        <span :class="getPnlClass(averageRoi)">\${ formatRoi(averageRoi) }</span>
                    </div>
                    <div class="col-md-5">
                        <strong>Performance:</strong> 
                        <span class="positive">Win \${ winRate }%</span> | 
                        <span>Draw \${ drawRate }%</span> | 
                        <span class="negative">Loss \${ lossRate }%</span>
                    </div>
                </div>
            </div>
        </div>
    `,
    
    props: {
        trades: {
            type: Array,
            required: true
        },
        uniqueSymbols: {
            type: Array,
            required: true
        },
        selectedTimezone: {
            type: String,
            required: true
        },
        selectedSymbol: {
            type: String,
            default: ''
        }
    },
    data() {
        return {
            currentPage: 1,
            pageSize: 10,
            pageSizeOptions: [10, 25, 50, 100],
            hideSmallTrades: true,
            localSelectedSymbol: this.selectedSymbol // Create a local copy of the prop
        };
    },

    computed: {
        symbolFilteredTrades() {
            if (!this.localSelectedSymbol) {
                return [...this.trades];
            }
            return this.trades.filter(trade => trade.symbol === this.localSelectedSymbol);
        },
        filteredTradesByPnL() {
            if (this.hideSmallTrades) {
                return this.symbolFilteredTrades.filter(trade => {
                    const pnl = parseFloat(trade.closed_pnl || 0);
                    return pnl >= 0.1 || pnl <= -0.1;
                });
            }
            return this.symbolFilteredTrades;
        },
        sortedTrades() {
            return [...this.filteredTradesByPnL].sort((a, b) =>
                parseInt(b.created_at) - parseInt(a.created_at)
            );
        },
        paginatedTrades() {
            const startIndex = (this.currentPage - 1) * this.pageSize;
            return this.sortedTrades.slice(startIndex, startIndex + this.pageSize);
        },
        totalPages() {
            return Math.ceil(this.sortedTrades.length / this.pageSize);
        },
        pageNumbers() {
            const pages = [];
            const maxVisiblePages = 5;
            
            if (this.totalPages <= maxVisiblePages) {
                for (let i = 1; i <= this.totalPages; i++) {
                    pages.push(i);
                }
            } else {
                pages.push(1);
                
                let start = Math.max(2, this.currentPage - 1);
                let end = Math.min(this.totalPages - 1, this.currentPage + 1);
                
                if (start === 2) end = Math.min(4, this.totalPages - 1);
                if (end === this.totalPages - 1) start = Math.max(2, this.totalPages - 3);
                
                if (start > 2) pages.push('...');
                
                for (let i = start; i <= end; i++) {
                    pages.push(i);
                }
                
                if (end < this.totalPages - 1) pages.push('...');
                
                pages.push(this.totalPages);
            }
            
            return pages;
        },
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
        totalPnl() {
             return this.sortedTrades.reduce((sum, trade) => {
                return sum + parseFloat(trade.closed_pnl || 0);
            }, 0);
        },
        averageRoi() {
            const totalRoi = this.sortedTrades.reduce((sum, trade) => {
                return sum + (trade.roi || 0);
            }, 0);
            return this.sortedTrades.length > 0 ? totalRoi / this.sortedTrades.length : 0;
        },
        winRate() {
            return this.tradeDistribution.winRate;
        },
        drawRate() {
            return this.tradeDistribution.drawRate;
        },
        lossRate() {
            return this.tradeDistribution.lossRate;
        }
    },
    methods: {
        formatTimestamp(timestampMs) {
            if (!timestampMs) return '-';
            // Use the timezone prop passed from the parent
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
        saveHideSmallTradesPreference() {
             localStorage.setItem('hideSmallTrades', this.hideSmallTrades);
        },
        loadHideSmallTradesPreference() {
            const savedPreference = localStorage.getItem('hideSmallTrades');
            if (savedPreference !== null) {
                this.hideSmallTrades = JSON.parse(savedPreference);
            }
        }
    },
    watch: {
        localSelectedSymbol(newSymbol) {
            this.currentPage = 1; // Reset to first page when changing symbol
            this.$emit('symbol-changed', newSymbol); // Emit event to parent
        },
        selectedSymbol(newSymbol) {
            // Update local copy when prop changes from parent
            this.localSelectedSymbol = newSymbol;
        },
        pageSize() {
            this.currentPage = 1; // Reset to first page when changing page size
        },
        hideSmallTrades(newValue) {
            this.saveHideSmallTradesPreference();
        },
        trades() {
            // Reset pagination when trades data changes
            this.currentPage = 1;
            // Changed to update localSelectedSymbol instead of directly modifying the prop
            this.localSelectedSymbol = '';
        }
    },
    created() {
        this.loadHideSmallTradesPreference();
    }
});