// static/js/components/PerformanceCharts.js
Vue.component('performance-charts', {
    delimiters: ['${', '}'],
    template: `
        <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0 matrix-header">Performance Analysis</h5>
                <div class="d-flex align-items-center">
                    <small class="text-muted me-3" v-if="lastUpdated">
                        <span v-if="usingCachedData" class="badge bg-info me-1">Cached</span>
                        Last updated: \${ formattedLastUpdated }
                    </small>
                    <div class="btn-group">
                        <button 
                            v-for="period in timePeriods" 
                            :key="period.value" 
                            @click="setTimePeriod(period.value)" 
                            class="btn btn-sm" 
                            :class="[selectedTimePeriod === period.value ? 'btn-secondary' : 'btn-outline-secondary']">
                            \${ period.label }
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-body">
                <div class="row">
                    <!-- Cumulative PnL Chart (2/3 width) -->
                    <div class="col-md-8">
                        <h6 class="text-center mb-3 chart-title">Cumulative PnL</h6>
                        <cumulative-pnl-chart 
                            :trades="trades" 
                            :time-unit="timeUnit"
                            :theme="theme">
                        </cumulative-pnl-chart>
                    </div>
                    
                    <!-- Top Performers Pie Chart (1/3 width) -->
                    <div class="col-md-4">
                        <h6 class="text-center mb-3 chart-title">Top performers</h6>
                        <top-performers-chart 
                            :top-coins="topPerformingCoins"
                            :theme="theme">
                        </top-performers-chart>
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
        topPerformingCoins: {
            type: Array,
            required: true
        },
        selectedTimePeriod: {
            type: String,
            required: true
        },
        timePeriods: {
            type: Array,
            required: true
        },
        lastUpdated: {
            type: String,
            default: null
        },
        usingCachedData: {
            type: Boolean,
            default: false
        },
        theme: {
            type: String,
            default: 'light'
        }
    },
    computed: {
        formattedLastUpdated() {
            if (!this.lastUpdated) return '';
            
            const date = new Date(this.lastUpdated);
            return date.toLocaleString();
        },
        timeUnit() {
            // Choose appropriate time unit based on selected period
            const daysNum = parseInt(this.selectedTimePeriod);
            if (daysNum <= 7) return 'day';
            if (daysNum <= 90) return 'week';
            return 'month';
        }
    },
    methods: {
        setTimePeriod(days) {
            if (this.selectedTimePeriod !== days) {
                this.$emit('time-period-changed', days);
            }
        }
    }
});