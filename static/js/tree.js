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

        this.init();
    }

    init() {
        // Set up SVG with margin
        this.margin = { top: 20, right: 140, bottom: 20, left: 60 };

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

    getIconEmoji(deviceClass) {
        return this.iconEmoji[deviceClass] || this.iconEmoji['unknown'];
    }

    /**
     * Detect physical hub groups - consecutive hubs with same vendor/product
     * that are likely part of the same physical device.
     */
    detectHubGroups(rootNode) {
        const groups = [];
        const visited = new Set();

        const findHubChain = (node, chain = []) => {
            if (!node || visited.has(node.data.port_path)) return chain;

            const isHub = node.data.device_class === 'hub';
            const hubKey = `${node.data.vendor_id}:${node.data.product_id}`;

            if (!isHub) return chain;

            // Start or continue a chain
            if (chain.length === 0) {
                chain.push({ node, key: hubKey });
                visited.add(node.data.port_path);
            }

            // Look for child hubs with same vendor/product
            if (node.children) {
                for (const child of node.children) {
                    const childIsHub = child.data.device_class === 'hub';
                    const childKey = `${child.data.vendor_id}:${child.data.product_id}`;

                    if (childIsHub && childKey === hubKey && !visited.has(child.data.port_path)) {
                        chain.push({ node: child, key: childKey });
                        visited.add(child.data.port_path);
                        findHubChain(child, chain);
                    }
                }
            }

            return chain;
        };

        // Traverse all nodes to find hub chains
        const traverse = (node) => {
            if (!node) return;

            if (node.data.device_class === 'hub' && !visited.has(node.data.port_path)) {
                const chain = findHubChain(node, []);
                if (chain.length > 1) {
                    groups.push(chain);
                }
            }

            if (node.children) {
                node.children.forEach(traverse);
            }
        };

        if (rootNode.children) {
            rootNode.children.forEach(traverse);
        }

        return groups;
    }

    /**
     * Calculate bounding box for a group of nodes with padding
     */
    calculateGroupBounds(group, padding = 25) {
        if (!group || group.length === 0) return null;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        // Include all nodes in the group
        for (const { node } of group) {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        }

        // Also include non-hub children of grouped hubs
        for (const { node } of group) {
            if (node.children) {
                for (const child of node.children) {
                    if (child.data.device_class !== 'hub' ||
                        !group.some(g => g.node === child)) {
                        minX = Math.min(minX, child.x);
                        maxX = Math.max(maxX, child.x);
                        // Extend Y to include device labels
                        maxY = Math.max(maxY, child.y + 150);
                    }
                }
            }
        }

        return {
            x: minX - padding,
            y: minY - padding,
            width: (maxY - minY) + padding * 2 + 150, // Note: x/y are swapped in horizontal tree
            height: (maxX - minX) + padding * 2,
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

        // Calculate tree layout with more vertical spacing for larger nodes
        const nodeCount = root.descendants().length;
        const dynamicHeight = Math.max(this.height, nodeCount * 42);

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
