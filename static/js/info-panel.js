/**
 * Device info panel display.
 */

class InfoPanel {
    constructor() {
        this.container = document.getElementById('info-content');
        this.currentDevice = null;
    }

    getIconName(deviceClass) {
        const iconMap = {
            'hub': 'git-branch',
            'hid_keyboard': 'keyboard',
            'hid_mouse': 'mouse',
            'hid_other': 'gamepad-2',
            'audio': 'volume-2',
            'video': 'video',
            'storage': 'hard-drive',
            'printer': 'printer',
            'wireless': 'wifi',
            'comm': 'cable',
            'unknown': 'usb'
        };
        return iconMap[deviceClass] || 'usb';
    }

    formatSpeed(speed) {
        if (!speed) return 'Unknown';
        if (speed.endsWith('G')) {
            return speed.replace('G', ' Gbps');
        }
        if (speed.endsWith('M')) {
            return speed.replace('M', ' Mbps');
        }
        return speed;
    }

    showDevice(device) {
        this.currentDevice = device;

        const iconName = this.getIconName(device.device_class);
        const hasErrors = device.errors && device.errors.length > 0;

        let errorsHtml = '';
        if (hasErrors) {
            const errorItems = device.errors.map(err => {
                const isWarning = err.toLowerCase().includes('warning') || err.toLowerCase().includes('info');
                return `<div class="error-item ${isWarning ? 'warning' : ''}">${this.escapeHtml(err)}</div>`;
            }).join('');
            errorsHtml = `
                <div class="info-section">
                    <h4>Errors</h4>
                    <div class="errors-list">${errorItems}</div>
                </div>
            `;
        }

        let childrenInfo = '';
        if (device.children && device.children.length > 0) {
            childrenInfo = `
                <div class="info-item">
                    <span class="label">Connected Devices</span>
                    <span class="value">${device.children.length}</span>
                </div>
            `;
        }

        let portsInfo = '';
        if (device.num_ports) {
            portsInfo = `
                <div class="info-item">
                    <span class="label">Ports</span>
                    <span class="value">${device.num_ports}</span>
                </div>
            `;
        }

        this.container.innerHTML = `
            <div class="device-info">
                <div class="device-header">
                    <div class="device-icon device-type-${device.device_class}">
                        <i data-lucide="${iconName}"></i>
                    </div>
                    <div class="device-title">
                        <h3>${this.escapeHtml(device.display_name)}</h3>
                        <div class="subtitle">${device.manufacturer || 'Unknown Manufacturer'}</div>
                    </div>
                </div>

                <div class="info-section">
                    <h4>Identification</h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="label">Vendor ID</span>
                            <span class="value">${device.vendor_id}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Product ID</span>
                            <span class="value">${device.product_id}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Bus</span>
                            <span class="value">${device.bus}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Device #</span>
                            <span class="value">${device.device}</span>
                        </div>
                    </div>
                </div>

                <div class="info-section">
                    <h4>Connection</h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="label">Port Path</span>
                            <span class="value">${device.port_path}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Speed</span>
                            <span class="value">${this.formatSpeed(device.speed)}</span>
                        </div>
                        ${portsInfo}
                        ${childrenInfo}
                        <div class="info-item">
                            <span class="label">Power</span>
                            <span class="value">${device.power_draw_ma}mA</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Driver</span>
                            <span class="value">${device.driver || 'None'}</span>
                        </div>
                    </div>
                </div>

                ${errorsHtml}

                <div class="info-section">
                    <h4>Actions</h4>
                    <div class="device-actions">
                        <button id="rename-btn" title="Set custom name">
                            <i data-lucide="edit-3"></i>
                            Rename
                        </button>
                        <button id="reset-btn" title="Reset device" ${device.is_root_hub ? 'disabled' : ''}>
                            <i data-lucide="refresh-cw"></i>
                            Reset
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Initialize Lucide icons
        lucide.createIcons();

        // Attach event handlers
        this.attachEventHandlers(device);
    }

    attachEventHandlers(device) {
        const renameBtn = document.getElementById('rename-btn');
        const resetBtn = document.getElementById('reset-btn');

        if (renameBtn) {
            renameBtn.addEventListener('click', () => this.showRenameModal(device));
        }

        if (resetBtn && !device.is_root_hub) {
            resetBtn.addEventListener('click', () => this.resetDevice(device));
        }
    }

    showRenameModal(device) {
        const modal = document.getElementById('name-modal');
        const deviceInfo = document.getElementById('modal-device-info');
        const input = document.getElementById('name-input');
        const saveBtn = document.getElementById('name-save-btn');
        const cancelBtn = document.getElementById('name-cancel-btn');

        deviceInfo.textContent = `${device.vendor_id}:${device.product_id} - ${device.product || 'Unknown Device'}`;
        input.value = device.custom_name || '';
        input.placeholder = device.product || 'Enter custom name';

        modal.classList.remove('hidden');
        input.focus();

        const handleSave = () => {
            const name = input.value.trim();
            if (name) {
                window.usbSocket.setDeviceName(device.vendor_id, device.product_id, name);
                // Update local state
                device.custom_name = name;
                device.display_name = name;
                this.showDevice(device);
            }
            closeModal();
        };

        const closeModal = () => {
            modal.classList.add('hidden');
            saveBtn.removeEventListener('click', handleSave);
            cancelBtn.removeEventListener('click', closeModal);
            input.removeEventListener('keydown', handleKeydown);
        };

        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') closeModal();
        };

        saveBtn.addEventListener('click', handleSave);
        cancelBtn.addEventListener('click', closeModal);
        input.addEventListener('keydown', handleKeydown);
    }

    resetDevice(device) {
        if (confirm(`Reset device "${device.display_name}" at ${device.port_path}?`)) {
            window.usbSocket.resetDevice(device.port_path);
            this.addLog('info', `Resetting device: ${device.display_name}`);
        }
    }

    addLog(type, message) {
        // Delegate to app.js log function if available
        if (window.addLogEntry) {
            window.addLogEntry(type, message);
        }
    }

    clear() {
        this.currentDevice = null;
        this.container.innerHTML = '<p class="placeholder">Click a device to view details</p>';
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global instance
window.infoPanel = new InfoPanel();
