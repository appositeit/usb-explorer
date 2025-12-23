/**
 * USB Debug Tool - Main application.
 */

class App {
    constructor() {
        this.logContainer = document.getElementById('log-content');
        this.connectionStatus = document.getElementById('connection-status');
        this.themeToggle = document.getElementById('theme-toggle');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.clearLogBtn = document.getElementById('clear-log-btn');

        this.darkMode = true;
        this.maxLogEntries = 100;

        this.init();
    }

    init() {
        // Set up WebSocket handlers
        window.usbSocket.on('onOpen', () => this.handleConnected());
        window.usbSocket.on('onClose', () => this.handleDisconnected());
        window.usbSocket.on('onMessage', (data) => this.handleMessage(data));

        // Connect WebSocket
        window.usbSocket.connect();

        // Set up UI handlers
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        this.refreshBtn.addEventListener('click', () => this.refresh());
        this.clearLogBtn.addEventListener('click', () => this.clearLog());

        // Initialize Lucide icons
        lucide.createIcons();

        console.log('USB Debug Tool initialized');
    }

    handleConnected() {
        this.connectionStatus.className = 'status-connected';
        this.connectionStatus.innerHTML = '<i data-lucide="wifi"></i> Connected';
        lucide.createIcons();
        this.addLogEntry('info', 'Connected to server');
    }

    handleDisconnected() {
        this.connectionStatus.className = 'status-disconnected';
        this.connectionStatus.innerHTML = '<i data-lucide="wifi-off"></i> Disconnected';
        lucide.createIcons();
        this.addLogEntry('error', 'Disconnected from server');
    }

    handleMessage(data) {
        const type = data.type;

        switch (type) {
            case 'full_tree':
                this.handleFullTree(data.data);
                break;

            case 'device_added':
                this.handleDeviceAdded(data.data);
                break;

            case 'device_removed':
                this.handleDeviceRemoved(data.port_path, data.data);
                break;

            case 'device_error':
                this.handleDeviceError(data.port_path, data.error);
                break;

            case 'name_updated':
                this.addLogEntry('info', 'Device name updated');
                window.usbSocket.refresh();
                break;

            case 'reset_result':
                if (data.success) {
                    this.addLogEntry('info', `Device reset: ${data.port_path}`);
                } else {
                    this.addLogEntry('error', `Failed to reset: ${data.port_path}`);
                }
                break;

            default:
                console.log('Unknown message type:', type, data);
        }
    }

    handleFullTree(devices) {
        console.log('Received device tree:', devices.length, 'root devices');
        window.usbTree.setDevices(devices);
    }

    handleDeviceAdded(device) {
        console.log('Device added:', device.display_name);

        // Play sound
        window.audioManager.playConnect();

        // Add to tree
        window.usbTree.addDevice(device);

        // Log entry with device colour
        const color = this.getDeviceColor(device.device_class);
        this.addLogEntry('add', `Connected: ${device.display_name}`, color);
    }

    handleDeviceRemoved(portPath, device) {
        const name = device ? device.display_name : portPath;
        console.log('Device removed:', name);

        // Play sound
        window.audioManager.playDisconnect();

        // Remove from tree
        window.usbTree.removeDevice(portPath);

        // Log entry
        const color = device ? this.getDeviceColor(device.device_class) : null;
        this.addLogEntry('remove', `Disconnected: ${name}`, color);

        // Clear info panel if showing this device
        if (window.infoPanel.currentDevice &&
            window.infoPanel.currentDevice.port_path === portPath) {
            window.infoPanel.clear();
        }
    }

    handleDeviceError(portPath, errorMessage) {
        console.log('Device error:', portPath, errorMessage);

        // Play error sound
        window.audioManager.playError();

        // Update tree
        const device = window.usbTree.findDevice(portPath);
        if (device) {
            if (!device.errors) device.errors = [];
            device.errors.push(errorMessage);
            device.has_errors = true;
            window.usbTree.render();

            // Update info panel if showing this device
            if (window.infoPanel.currentDevice &&
                window.infoPanel.currentDevice.port_path === portPath) {
                window.infoPanel.showDevice(device);
            }
        }

        // Log entry
        this.addLogEntry('error', `Error on ${portPath}: ${errorMessage}`);
    }

    getDeviceColor(deviceClass) {
        const colors = {
            'hub': '#3b82f6',
            'hid_keyboard': '#22c55e',
            'hid_mouse': '#22c55e',
            'hid_other': '#22c55e',
            'storage': '#f97316',
            'audio': '#a855f7',
            'video': '#ec4899',
            'wireless': '#06b6d4',
            'comm': '#06b6d4',
            'unknown': '#6b7280'
        };
        return colors[deviceClass] || colors.unknown;
    }

    addLogEntry(type, message, color = null) {
        // Remove placeholder
        const placeholder = this.logContainer.querySelector('.log-placeholder');
        if (placeholder) placeholder.remove();

        // Create entry
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;

        if (color) {
            entry.style.borderLeftColor = color;
        }

        const now = new Date();
        const time = now.toLocaleTimeString('en-AU', { hour12: false });

        let icon = 'info';
        if (type === 'add') icon = 'plus-circle';
        else if (type === 'remove') icon = 'minus-circle';
        else if (type === 'error') icon = 'alert-triangle';

        entry.innerHTML = `
            <span class="time">${time}</span>
            <i data-lucide="${icon}" class="icon"></i>
            <span class="message">${this.escapeHtml(message)}</span>
        `;

        // Add to container
        this.logContainer.appendChild(entry);

        // Initialize icons
        lucide.createIcons();

        // Scroll to bottom
        this.logContainer.scrollTop = this.logContainer.scrollHeight;

        // Limit entries
        while (this.logContainer.children.length > this.maxLogEntries) {
            this.logContainer.removeChild(this.logContainer.firstChild);
        }
    }

    refresh() {
        window.usbSocket.refresh();
        this.addLogEntry('info', 'Refreshing device tree...');
    }

    clearLog() {
        this.logContainer.innerHTML = '<div class="log-placeholder">Waiting for events...</div>';
    }

    toggleTheme() {
        this.darkMode = !this.darkMode;
        document.body.classList.toggle('dark-mode', this.darkMode);

        const icon = this.themeToggle.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', this.darkMode ? 'moon' : 'sun');
            lucide.createIcons();
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global log entry function for other modules
window.addLogEntry = function(type, message, color) {
    if (window.app) {
        window.app.addLogEntry(type, message, color);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
