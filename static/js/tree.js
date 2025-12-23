/**
 * D3.js USB device tree visualization.
 */

class USBTree {
    constructor() {
        this.svg = d3.select('#tree-svg');
        this.container = document.getElementById('tree-container');
        this.devices = [];
        this.selectedNode = null;

        // Colour mapping for device types
        this.colors = {
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

        // Animation state
        this.removingNodes = new Set();
        this.addingNodes = new Set();

        this.init();
    }

    init() {
        // Set up SVG with margin
        this.margin = { top: 20, right: 120, bottom: 20, left: 60 };

        // Resize handler
        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width - this.margin.left - this.margin.right;
        this.height = Math.max(400, rect.height) - this.margin.top - this.margin.bottom;

        this.svg
            .attr('width', rect.width)
            .attr('height', Math.max(400, rect.height));

        if (this.devices.length > 0) {
            this.render();
        }
    }

    setDevices(devices) {
        // Track additions
        const oldPaths = new Set(this.getAllPaths(this.devices));
        const newPaths = new Set(this.getAllPaths(devices));

        // Find new devices
        newPaths.forEach(path => {
            if (!oldPaths.has(path)) {
                this.addingNodes.add(path);
                // Clear after animation
                setTimeout(() => this.addingNodes.delete(path), 600);
            }
        });

        this.devices = devices;
        this.render();
    }

    getAllPaths(devices) {
        const paths = [];
        const traverse = (devs) => {
            devs.forEach(d => {
                paths.push(d.port_path);
                if (d.children) traverse(d.children);
            });
        };
        traverse(devices);
        return paths;
    }

    addDevice(device) {
        // Mark as adding
        this.addingNodes.add(device.port_path);
        setTimeout(() => this.addingNodes.delete(device.port_path), 600);

        // Find parent and add
        const parentPath = device.parent_path;
        if (parentPath) {
            const parent = this.findDevice(parentPath);
            if (parent) {
                if (!parent.children) parent.children = [];
                parent.children.push(device);
            } else {
                // Add as root
                this.devices.push(device);
            }
        } else {
            this.devices.push(device);
        }

        this.render();
    }

    removeDevice(portPath) {
        // Mark as removing
        this.removingNodes.add(portPath);

        // Also mark all children
        const device = this.findDevice(portPath);
        if (device && device.children) {
            const markChildren = (d) => {
                this.removingNodes.add(d.port_path);
                if (d.children) d.children.forEach(markChildren);
            };
            device.children.forEach(markChildren);
        }

        // Wait for animation then remove
        setTimeout(() => {
            this.removingNodes.clear();
            this.devices = this.filterDevice(this.devices, portPath);
            this.render();
        }, 500);

        this.render();
    }

    findDevice(portPath) {
        const search = (devices) => {
            for (const d of devices) {
                if (d.port_path === portPath) return d;
                if (d.children) {
                    const found = search(d.children);
                    if (found) return found;
                }
            }
            return null;
        };
        return search(this.devices);
    }

    filterDevice(devices, portPath) {
        return devices.filter(d => {
            if (d.port_path === portPath) return false;
            if (d.children) {
                d.children = this.filterDevice(d.children, portPath);
            }
            return true;
        });
    }

    updateDeviceErrors(portPath, errors) {
        const device = this.findDevice(portPath);
        if (device) {
            device.errors = errors;
            device.has_errors = errors && errors.length > 0;
            this.render();
        }
    }

    render() {
        // Clear SVG
        this.svg.selectAll('*').remove();

        if (this.devices.length === 0) {
            this.svg.append('text')
                .attr('x', this.width / 2)
                .attr('y', this.height / 2)
                .attr('text-anchor', 'middle')
                .attr('fill', 'var(--text-muted)')
                .text('No USB devices found');
            return;
        }

        // Create a virtual root to hold multiple root hubs
        const virtualRoot = {
            port_path: 'root',
            display_name: 'USB',
            device_class: 'unknown',
            children: this.devices
        };

        // Create hierarchy
        const root = d3.hierarchy(virtualRoot);

        // Calculate tree layout
        const nodeCount = root.descendants().length;
        const dynamicHeight = Math.max(this.height, nodeCount * 35);

        const treeLayout = d3.tree()
            .size([dynamicHeight, this.width - 200]);

        treeLayout(root);

        // Update SVG height if needed
        const svgHeight = dynamicHeight + this.margin.top + this.margin.bottom;
        this.svg.attr('height', svgHeight);

        // Create main group with margin
        const g = this.svg.append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

        // Draw links
        g.selectAll('.link')
            .data(root.links().filter(l => l.source.data.port_path !== 'root'))
            .enter()
            .append('path')
            .attr('class', 'link')
            .attr('d', d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x));

        // Draw nodes (skip virtual root)
        const nodes = g.selectAll('.node')
            .data(root.descendants().filter(d => d.data.port_path !== 'root'))
            .enter()
            .append('g')
            .attr('class', d => {
                let classes = 'node';
                if (this.removingNodes.has(d.data.port_path)) classes += ' removing';
                if (this.addingNodes.has(d.data.port_path)) classes += ' adding';
                if (d.data.has_errors) classes += ' has-error';
                if (this.selectedNode === d.data.port_path) classes += ' selected';
                return classes;
            })
            .attr('transform', d => `translate(${d.y},${d.x})`)
            .on('click', (event, d) => this.handleNodeClick(d.data));

        // Node circles
        nodes.append('circle')
            .attr('r', d => d.data.device_class === 'hub' ? 10 : 7)
            .attr('fill', d => this.colors[d.data.device_class] || this.colors.unknown)
            .attr('stroke', d => d.data.has_errors ? 'var(--error-color)' : 'white');

        // Error indicator
        nodes.filter(d => d.data.has_errors)
            .append('text')
            .attr('dy', -15)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--error-color)')
            .style('font-size', '12px')
            .text('⚠');

        // Node labels
        nodes.append('text')
            .attr('dy', 4)
            .attr('x', d => d.children ? -15 : 15)
            .attr('text-anchor', d => d.children ? 'end' : 'start')
            .text(d => this.truncate(d.data.display_name, 25))
            .append('title')
            .text(d => `${d.data.display_name}\n${d.data.port_path}`);

        // Speed indicator
        nodes.append('text')
            .attr('dy', 18)
            .attr('x', d => d.children ? -15 : 15)
            .attr('text-anchor', d => d.children ? 'end' : 'start')
            .attr('fill', 'var(--text-muted)')
            .style('font-size', '9px')
            .text(d => d.data.speed || '');
    }

    truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.substring(0, len - 1) + '…' : str;
    }

    handleNodeClick(device) {
        this.selectedNode = device.port_path;
        this.render();

        // Show in info panel
        if (window.infoPanel) {
            window.infoPanel.showDevice(device);
        }
    }

    selectDevice(portPath) {
        this.selectedNode = portPath;
        this.render();
    }

    clearSelection() {
        this.selectedNode = null;
        this.render();
    }
}

// Global instance
window.usbTree = new USBTree();
