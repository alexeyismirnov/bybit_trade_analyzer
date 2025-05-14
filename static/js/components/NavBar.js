// static/js/components/NavBar.js
Vue.component('nav-bar', {
    delimiters: ['${', '}'],
    template: `
        <nav class="navbar navbar-expand-lg navbar-light bg-light w-100 mb-3">
            <div class="container-fluid">
                <div class="row w-100 align-items-center">
                    <!-- Wallet Balance on the left (visible on medium+ screens) -->
                    <div class="col-md-4 d-none d-md-flex justify-content-start">
                        <div class="navbar-balance">
                            <span v-if="loadingBalance">Loading...</span>
                            <span v-else-if="balanceError" class="text-danger">\${ balanceError }</span>
                            <span v-else-if="walletBalance !== null">\${ exchangeDisplay }: \${ walletBalance } \${ currencyDisplay }</span>
                        </div>
                    </div>

                    <!-- Title - centered on all screens -->
                    <div class="col-12 col-md-4 text-center">
                        <span class="matrix-title">\${ title }</span>
                    </div>
                    
                    <!-- Settings and logout buttons on the right (visible on medium+ screens) -->
                    <div class="col-md-4 d-none d-md-flex justify-content-end">
                         <div class="navbar-settings">
                            <button class="btn btn-outline-secondary me-2" @click="onSettingsClick">
                                <i class="bi bi-gear"></i> Settings
                            </button>
                            <a :href="logoutUrl" class="btn btn-outline-secondary">
                                <i class="bi bi-box-arrow-right"></i> Logout
                            </a>
                        </div>
                    </div>

                    <!-- Balance and Buttons - stacked on small screens -->
                     <div class="col-12 d-md-none mt-2 text-center">
                        <div class="navbar-balance mb-2">
                            <span v-if="loadingBalance">Loading...</span>
                            <span v-else-if="balanceError" class="text-danger">\${ balanceError }</span>
                            <span v-else-if="walletBalance !== null">\${ exchangeDisplay }: \${ walletBalance } \${ currencyDisplay }</span>
                        </div>
                         <div class="navbar-settings d-flex align-items-baseline justify-content-center">
                            <button class="btn btn-outline-secondary me-2" @click="onSettingsClick">
                                <i class="bi bi-gear"></i> Settings
                            </button>
                            <a :href="logoutUrl" class="btn btn-outline-secondary">
                                <i class="bi bi-box-arrow-right"></i> Logout
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    `,
    data() {
        return {
            walletBalance: null,
            loadingBalance: false,
            balanceError: null,
            exchange: 'bybit' // Default exchange
        };
    },
    props: {
        title: {
            type: String,
            default: 'REDFLOW STRATEGY'
        },
        logoutUrl: {
            type: String,
            required: true
        },
        selectedExchange: {
            type: String,
            default: 'bybit'
        }
    },
    computed: {
        exchangeDisplay() {
            return this.exchange.charAt(0).toUpperCase() + this.exchange.slice(1);
        },
        currencyDisplay() {
            // Different exchanges use different currencies
            return this.exchange === 'hyperliquid' ? 'USDC' : 'USDT';
        }
    },
    watch: {
        selectedExchange(newExchange) {
            if (this.exchange !== newExchange) {
                this.exchange = newExchange;
                this.fetchWalletBalance();
            }
        }
    },
    mounted() {
        // Initialize exchange from props or localStorage
        const savedExchange = localStorage.getItem('selectedExchange');
        this.exchange = savedExchange || this.selectedExchange;
        this.fetchWalletBalance();
    },
    methods: {
        onSettingsClick() {
            this.$emit('settings-click');
        },
        fetchWalletBalance() {
            this.loadingBalance = true;
            this.balanceError = null;
            axios.get(`/api/wallet-balance?exchange=${this.exchange}`)
                .then(response => {
                    if (response.data.success) {
                        this.walletBalance = parseFloat(response.data.wallet_balance).toFixed(2);
                    } else {
                        this.balanceError = response.data.error;
                        console.error("Error fetching wallet balance:", response.data.error);
                    }
                })
                .catch(error => {
                    this.balanceError = 'Failed to fetch wallet balance.';
                    console.error("Error fetching wallet balance:", error);
                })
                .finally(() => {
                    this.loadingBalance = false;
                });
        }
    }
});