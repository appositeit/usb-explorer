/**
 * D3.js USB device tree visualization with icons.
 */

class USBTree {
    constructor() {
        this.svg = d3.select('#tree-svg');
        this.container = document.getElementById('tree-container');
        this.devices = [];
        this.selectedNode = null;
        this.hubGroups = []; // Physical hub groupings

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
            'printer': '#8b5cf6',
            'unknown': '#6b7280'
        };

        // Unicode emoji icons for simpler rendering
        this.iconEmoji = {
            'hub': '🔌',
            'hid_keyboard': '⌨',
            'hid_mouse': '🖱',
            'hid_other': '🎮',
            'audio': '🔊',
            'video': '📹',
            'storage': '💾',
            'printer': '🖨',
            'wireless': '📶',
            'comm': '📟',
            'unknown': '❓'
        };

        // Animation state
        this.removingNodes = new Set();
        this.addingNodes = new Set();
        this.pendingRemovals = new Map();  // portPath -> timeoutId

        // Node spacing (adjustable via slider)
        this.nodeSpacing = parseInt(localStorage.getItem('usbTreeSpacing')) || 42;

        this.init();
    }

    init() {
        // Set up SVG with margin
        this.margin = { top: 20, right: 140, bottom: 20, left: 60 };

        // Resize handler
        window.addEventListener('resize', () => this.resize());
        this.resize();

        // Spacing slider setup
        const spacingSlider = document.getElementById('spacing-slider');
        const spacingValue = document.getElementById('spacing-value');
        if (spacingSlider) {
            // Set initial value from stored preference
            spacingSlider.value = this.nodeSpacing;
            if (spacingValue) spacingValue.textContent = this.nodeSpacing;

            spacingSlider.addEventListener('input', (e) => {
                this.nodeSpacing = parseInt(e.target.value);
                if (spacingValue) spacingValue.textContent = this.nodeSpacing;
                localStorage.setItem('usbTreeSpacing', this.nodeSpacing);
                this.render();
            });
        }
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
        // Cancel any pending removal for this device (handles quick reconnects)
        if (this.pendingRemovals.has(device.port_path)) {
            clearTimeout(this.pendingRemovals.get(device.port_path));
            this.pendingRemovals.delete(device.port_path);
            this.removingNodes.delete(device.port_path);
            console.log('Cancelled pending removal for:', device.port_path);
        }

        // Mark as adding
        this.addingNodes.add(device.port_path);
        setTimeout(() => this.addingNodes.delete(device.port_path), 600);

        // Check if device already exists (could happen with quick reconnect)
        const existing = this.findDevice(device.port_path);
        if (existing) {
            // Update existing device data instead of adding duplicate
            Object.assign(existing, device);
            this.render();
            return;
        }

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

        // Store timeout so it can be cancelled if device reconnects quickly
        const timeoutId = setTimeout(() => {
            this.pendingRemovals.delete(portPath);
            this.removingNodes.delete(portPath);
            this.devices = this.filterDevice(this.devices, portPath);
            this.render();
        }, 500);

        this.pendingRemovals.set(portPath, timeoutId);
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

    getIconEmoji(deviceClass) {
        return this.iconEmoji[deviceClass] || this.iconEmoji['unknown'];
    }

    /**
     * Detect physical hub groups - all hubs with same vendor/product
     * under a common ancestor are likely part of the same physical device.
     */
    detectHubGroups(rootNode) {
        const groups = [];

        // Collect all hubs with their ancestry info
        const allHubs = [];
        const collectHubs = (node, ancestors = []) => {
            if (!node) return;

            if (node.data.device_class === 'hub' && node.data.port_path !== 'root') {
                allHubs.push({
                    node,
                    key: `${node.data.vendor_id}:${node.data.product_id}`,
                    ancestors: [...ancestors],
                    portPath: node.data.port_path
                });
            }

            if (node.children) {
                const newAncestors = node.data.port_path !== 'root'
                    ? [...ancestors, node.data.port_path]
                    : ancestors;
                node.children.forEach(child => collectHubs(child, newAncestors));
            }
        };
        collectHubs(rootNode);

        // Group hubs by vendor:product that share a common hub ancestor
        const used = new Set();

        for (const hub of allHubs) {
            if (used.has(hub.portPath)) continue;

            // Find all hubs with same key that are descendants of this hub
            // OR siblings under the same parent hub
            const group = [hub];
            used.add(hub.portPath);

            for (const other of allHubs) {
                if (used.has(other.portPath)) continue;
                if (other.key !== hub.key) continue;

                // Check if other is a descendant of hub
                const isDescendant = other.ancestors.includes(hub.portPath);

                // Check if they share a common hub ancestor with same vendor
                const shareAncestor = hub.ancestors.some(ancestorPath => {
                    const ancestorHub = allHubs.find(h => h.portPath === ancestorPath);
                    return ancestorHub && ancestorHub.key === hub.key &&
                           other.ancestors.includes(ancestorPath);
                });

                // Check if hub is ancestor of other or vice versa
                const hubIsAncestor = other.ancestors.includes(hub.portPath);
                const otherIsAncestor = hub.ancestors.includes(other.portPath);

                if (isDescendant || shareAncestor || hubIsAncestor || otherIsAncestor) {
                    group.push(other);
                    used.add(other.portPath);
                }
            }

            if (group.length > 1) {
                groups.push(group);
            }
        }

        return groups;
    }

    /**
     * Calculate bounding box for hub group - ONLY includes hub nodes
     */
    calculateGroupBounds(group, padding = 20) {
        if (!group || group.length === 0) return null;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        // Only include hub nodes in the bounding box
        for (const hub of group) {
            const node = hub.node;
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        }

        return {
            x: minX - padding,
            y: minY - padding - 20, // Extra space for label
            width: (maxY - minY) + padding * 2,
            height: (maxX - minX) + padding * 2 + 20,
            vendorId: group[0].node.data.vendor_id,
            vendorName: group[0].node.data.vendor_name || group[0].node.data.vendor_id,
            hubCount: group.length
        };
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

        // Calculate tree layout with adjustable vertical spacing
        const nodeCount = root.descendants().length;
        const dynamicHeight = Math.max(this.height, nodeCount * this.nodeSpacing);

        const treeLayout = d3.tree()
            .size([dynamicHeight, this.width - 180]);

        treeLayout(root);

        // Update SVG height if needed
        const svgHeight = dynamicHeight + this.margin.top + this.margin.bottom;
        this.svg.attr('height', svgHeight);

        // Create main group with margin
        const g = this.svg.append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

        // Detect and draw physical hub groups (before links and nodes so they're behind)
        const hubGroups = this.detectHubGroups(root);
        const groupColors = ['rgba(59, 130, 246, 0.08)', 'rgba(168, 85, 247, 0.08)', 'rgba(34, 197, 94, 0.08)'];

        hubGroups.forEach((group, index) => {
            const bounds = this.calculateGroupBounds(group);
            if (bounds) {
                const colorIndex = index % groupColors.length;

                // Draw rounded rectangle for group
                g.append('rect')
                    .attr('class', 'hub-group')
                    .attr('x', bounds.y)
                    .attr('y', bounds.x)
                    .attr('width', bounds.width)
                    .attr('height', bounds.height)
                    .attr('rx', 12)
                    .attr('ry', 12)
                    .attr('fill', groupColors[colorIndex])
                    .attr('stroke', groupColors[colorIndex].replace('0.08', '0.3'))
                    .attr('stroke-width', 2)
                    .attr('stroke-dasharray', '6,3');

                // Add label for the physical hub
                g.append('text')
                    .attr('class', 'hub-group-label')
                    .attr('x', bounds.y + 8)
                    .attr('y', bounds.x + 16)
                    .attr('fill', 'var(--text-muted)')
                    .style('font-size', '11px')
                    .style('font-style', 'italic')
                    .text(`${bounds.vendorName} (${bounds.hubCount}-chip hub)`);
            }
        });

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

        // Node background circles
        nodes.append('circle')
            .attr('r', d => d.data.device_class === 'hub' ? 18 : 16)
            .attr('fill', d => this.colors[d.data.device_class] || this.colors.unknown)
            .attr('stroke', d => d.data.has_errors ? 'var(--error-color)' : 'rgba(255,255,255,0.3)')
            .attr('stroke-width', d => d.data.has_errors ? 2 : 1);

        // Add emoji icons inside nodes
        nodes.append('text')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('dy', 1)
            .style('font-size', d => d.data.device_class === 'hub' ? '18px' : '16px')
            .text(d => this.getIconEmoji(d.data.device_class));

        // Error indicator
        nodes.filter(d => d.data.has_errors)
            .append('text')
            .attr('dy', -16)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--error-color)')
            .style('font-size', '12px')
            .text('⚠');

        // Node labels
        nodes.append('text')
            .attr('class', 'node-label')
            .attr('dy', 6)
            .attr('x', d => d.children ? -24 : 24)
            .attr('text-anchor', d => d.children ? 'end' : 'start')
            .style('font-size', '15px')
            .style('font-weight', '500')
            .text(d => this.truncate(d.data.display_name, 35))
            .append('title')
            .text(d => `${d.data.display_name}\nPath: ${d.data.port_path}\nType: ${d.data.device_class}`);

        // Speed indicator below label
        nodes.append('text')
            .attr('class', 'node-speed')
            .attr('dy', 24)
            .attr('x', d => d.children ? -24 : 24)
            .attr('text-anchor', d => d.children ? 'end' : 'start')
            .attr('fill', 'var(--text-muted)')
            .style('font-size', '12px')
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
