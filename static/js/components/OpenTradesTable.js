// static/js/components/OpenTradesTable.js
Vue.component('open-trades-table', {
    delimiters: ['${', '}'],
    template: `
        <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0 matrix-header">Open Trades</h5>
                <div>
                    <button class="btn btn-sm btn-outline-secondary" @click="onRefreshClick">
                        <i class="bi bi-arrow-clockwise"></i> Refresh
                    </button>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead class="header-row">
                            <tr>
                                <th>Symbol</th>
                                <th>Contracts</th>
                                <th>Notional</th>
                                <th>Current ROI (%)</th>
                                <th>Realized PnL</th>
                                <th>Unrealized PnL</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="trade in sortedTrades" :key="trade.symbol">
                                <td :class="getDirectionClass(trade)">
                                    <span v-html="formatSymbol(trade)"></span>
                                </td>
                                <td>\${ trade.size }</td>
                                <td>\${ formatPrice(trade.positionValue) }</td>
                                <td :class="getRoiClass(trade.roi)">\${ formatRoi(trade.roi) }</td>
                                <td :class="getPnlClass(trade.curRealisedPnl)">\${ formatPnl(trade.curRealisedPnl) }</td>
                                <td :class="getUnrealisedPnlClass(trade.unrealisedPnl)">\${ formatUnrealisedPnl(trade.unrealisedPnl) }</td>
                            </tr>
                            <tr v-if="sortedTrades.length === 0">
                                <td colspan="6" class="text-center">No open trades found</td>
                            </tr>
                        </tbody>
                        <tfoot v-if="sortedTrades.length > 0">
                            <tr>
                                <td colspan="5" class="text-end"><strong>Total Unrealized PnL:</strong></td>
                                <td :class="getUnrealisedPnlClass(totalUnrealisedPnl)">\${ formatUnrealisedPnl(totalUnrealisedPnl) }</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    `,
    props: {
        trades: {
            type: Array,
            required: true
        }
    },
    computed: {
        sortedTrades() {
            return [...this.trades].sort((a, b) =>
                parseInt(b.updatedTime) - parseInt(a.updatedTime)
            );
        },
        totalUnrealisedPnl() {
            return this.trades.reduce((sum, trade) => {
                return sum + parseFloat(trade.unrealisedPnl || 0);
            }, 0);
        }
    },
    methods: {
        formatSymbol(trade) {
            let symbol = trade.symbol;
            if (symbol.endsWith(':USDT')) {
                symbol = symbol.slice(0, -5); // Remove ':USDT'
            }
            if (trade.side === 'long') {
                return '<i class="bi bi-caret-up-fill"></i> ' + symbol;
            } else {
                return '<i class="bi bi-caret-down-fill"></i> ' + symbol;
            }
        },
        getDirectionClass(trade) {
            return trade.side === 'long' ? 'positive' : 'negative';
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
        formatUnrealisedPnl(pnl) {
            if (!pnl) return '-';
            return parseFloat(pnl).toFixed(4);
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
        getUnrealisedPnlClass(pnl) {
            if (pnl === undefined || pnl === null) return '';
            const numPnl = parseFloat(pnl);
            if (isNaN(numPnl)) return '';
            return numPnl >= 0 ? 'positive' : 'negative';
        },
        onRefreshClick() {
            this.$emit('refresh');
        }
    }
});