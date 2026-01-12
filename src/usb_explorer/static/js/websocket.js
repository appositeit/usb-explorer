/**
 * WebSocket client with auto-reconnection.
 */

class USBWebSocket {
    constructor() {
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.callbacks = {
            onOpen: [],
            onClose: [],
            onMessage: [],
            onError: []
        };
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws`;

        console.log('Connecting to WebSocket:', url);

        this.socket = new WebSocket(url);

        this.socket.onopen = (event) => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.callbacks.onOpen.forEach(cb => cb(event));
        };

        this.socket.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            this.callbacks.onClose.forEach(cb => cb(event));
            this.scheduleReconnect();
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.callbacks.onError.forEach(cb => cb(error));
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.callbacks.onMessage.forEach(cb => cb(data));
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached');
            return;
        }

        const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
        this.reconnectAttempts++;

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
                this.connect();
            }
        }, delay);
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
            return true;
        }
        console.warn('WebSocket not connected');
        return false;
    }

    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }

    off(event, callback) {
        if (this.callbacks[event]) {
            const index = this.callbacks[event].indexOf(callback);
            if (index > -1) {
                this.callbacks[event].splice(index, 1);
            }
        }
    }

    get isConnected() {
        return this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    refresh() {
        this.send({ action: 'refresh' });
    }

    setDeviceName(vendorId, productId, name) {
        this.send({
            action: 'set_name',
            vendor_id: vendorId,
            product_id: productId,
            name: name
        });
    }

    resetDevice(portPath) {
        this.send({
            action: 'reset_device',
            port_path: portPath
        });
    }
}

// Global instance
window.usbSocket = new USBWebSocket();
