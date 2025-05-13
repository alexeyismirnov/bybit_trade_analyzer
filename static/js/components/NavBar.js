// static/js/components/NavBar.js
Vue.component('nav-bar', {
    delimiters: ['${', '}'],
    template: `
        <nav class="navbar navbar-expand-lg navbar-light bg-light w-100 mb-3">
            <div class="container-fluid">
                <!-- Centered title with Matrix styling -->
                <span class="matrix-title">\${ title }</span>
                
                <!-- Settings and logout buttons positioned absolutely -->
                <div class="navbar-settings">
                    <button class="btn btn-outline-secondary me-2" @click="onSettingsClick">
                        <i class="bi bi-gear"></i> Settings
                    </button>
                    <a :href="logoutUrl" class="btn btn-outline-secondary">
                        <i class="bi bi-box-arrow-right"></i> Logout
                    </a>
                </div>
            </div>
        </nav>
    `,
    props: {
        title: {
            type: String,
            default: 'REDFLOW STRATEGY'
        },
        logoutUrl: {
            type: String,
            required: true
        }
    },
    methods: {
        onSettingsClick() {
            this.$emit('settings-click');
        }
    }
});