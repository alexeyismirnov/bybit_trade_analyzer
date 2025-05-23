// static/js/components/SettingsModal.js

Vue.component('settings-modal', {
    delimiters: ['${', '}'], // Match the main app's delimiters
    props: {
        show: {
            type: Boolean,
            default: false
        },
        initialTimezone: {
            type: String,
            default: 'UTC'
        },
        initialTheme: {
            type: String,
            default: 'light'
        },
        initialExchange: {
            type: String,
            default: 'bybit'
        }
    },
    data() {
        return {
            selectedTimezone: this.initialTimezone,
            selectedTheme: this.initialTheme,
            selectedExchange: this.initialExchange,
            timezones: [
                { label: 'UTC', value: 'UTC' },
                { label: 'GMT', value: 'GMT' },
                { label: 'America/New_York', value: 'America/New_York' },
                { label: 'America/Chicago', value: 'America/Chicago' },
                { label: 'America/Denver', value: 'America/Denver' },
                { label: 'America/Los_Angeles', value: 'America/Los_Angeles' },
                { label: 'Europe/London', value: 'Europe/London' },
                { label: 'Europe/Berlin', value: 'Europe/Berlin' },
                { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
                { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
                { label: 'Asia/Hong_Kong', value: 'Asia/Hong_Kong' },
                { label: 'Australia/Sydney', value: 'Australia/Sydney' }
            ],
            exchanges: [
                { label: 'Bybit', value: 'bybit' },
                { label: 'Hyperliquid', value: 'hyperliquid' }
            ],
            modal: null,
            isDatabaseAvailable: false // New data property
        };
    },
    watch: {
        show(newVal) {
            if (newVal) {
                this.showModal();
            } else {
                this.hideModal();
            }
        },
        initialTimezone(newVal) {
            this.selectedTimezone = newVal;
        },
        initialTheme(newVal) {
            this.selectedTheme = newVal;
        },
        initialExchange(newVal) {
            this.selectedExchange = newVal;
        }
    },
    mounted() {
        if (this.show) {
            this.showModal();
        }
    },
    methods: {
        showModal() {
            this.$nextTick(() => {
                this.modal = new bootstrap.Modal(this.$refs.settingsModal);
                this.modal.show();
                this.$refs.settingsModal.addEventListener('hidden.bs.modal', this.onModalHidden);
                // Fetch database status when modal is shown
                this.checkDatabaseStatus();
            });
        },
        hideModal() {
            if (this.modal) {
                this.modal.hide();
            }
        },
        onModalHidden() {
            this.$emit('hidden');
        },
        saveSettings() {
            // Save settings to localStorage
            localStorage.setItem('selectedTimezone', this.selectedTimezone);
            localStorage.setItem('theme', this.selectedTheme);
            localStorage.setItem('selectedExchange', this.selectedExchange);
            
            // Emit event to parent component
            this.$emit('save-settings', {
                timezone: this.selectedTimezone,
                theme: this.selectedTheme,
                exchange: this.selectedExchange
            });
            
            // Hide modal
            this.hideModal();
        },
        eraseDatabase() {
            if (confirm("Are you sure you want to erase all cached data? This action cannot be undone.")) {
                fetch('/api/erase-db', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert(data.message);
                        // Optionally emit an event to notify parent component
                        this.$emit('database-erased');
                    } else {
                        alert("Error: " + data.error);
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert("An error occurred while trying to erase the database.");
                });
            }
        },
        checkDatabaseStatus() {
            fetch('/api/db-status')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        this.isDatabaseAvailable = data.is_available;
                    } else {
                        console.error("Error fetching database status:", data.error);
                        this.isDatabaseAvailable = false; // Assume not available on error
                    }
                })
                .catch(error => {
                    console.error('Error fetching database status:', error);
                    this.isDatabaseAvailable = false; // Assume not available on error
                });
        }
    },
    beforeDestroy() {
        // Clean up event listeners
        if (this.$refs.settingsModal) {
            this.$refs.settingsModal.removeEventListener('hidden.bs.modal', this.onModalHidden);
        }
    },
    template: `
        <div class="modal fade" ref="settingsModal" tabindex="-1" aria-labelledby="settingsModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="settingsModalLabel">Settings</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="exchangeSelect" class="form-label">Select Exchange:</label>
                            <select class="form-select" id="exchangeSelect" v-model="selectedExchange">
                                <option v-for="exchangeOption in exchanges" :key="exchangeOption.value" :value="exchangeOption.value">\${ exchangeOption.label }</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label for="timezoneSelect" class="form-label">Select Timezone:</label>
                            <select class="form-select" id="timezoneSelect" v-model="selectedTimezone">
                                <option v-for="tz in timezones" :key="tz.value" :value="tz.value">\${ tz.label }</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label for="themeSelect" class="form-label">Select Theme:</label>
                            <select class="form-select" id="themeSelect" v-model="selectedTheme">
                                <option value="light">Light</option>
                                <option value="dark">Dark</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-danger me-auto" @click="eraseDatabase" :disabled="!isDatabaseAvailable">Erase DB</button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" @click="saveSettings">Save changes</button>
                    </div>
                </div>
            </div>
        </div>
    `
});