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

        // Custom hub labels from config
        this.hubLabels = {};

        // Learned physical groups from config
        this.physicalGroups = [];

        this.init();
    }

    init() {
        // Set up SVG with margin
        this.margin = { top: 20, right: 140, bottom: 20, left: 60 };

        // Resize handler
        window.addEventListener('resize', () => this.resize());
        this.resize();

        // Load hub labels and physical groups from config
        this.loadHubLabels();
        this.loadPhysicalGroups();

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

    async loadHubLabels() {
        try {
            const response = await fetch('/api/hub-labels');
            if (response.ok) {
                this.hubLabels = await response.json();
                // Re-render if we have devices
                if (this.devices.length > 0) {
                    this.render();
                }
            }
        } catch (e) {
            console.warn('Failed to load hub labels:', e);
        }
    }

    async loadPhysicalGroups() {
        try {
            const response = await fetch('/api/physical-groups');
            if (response.ok) {
                this.physicalGroups = await response.json();
                // Re-render if we have devices
                if (this.devices.length > 0) {
                    this.render();
                }
            }
        } catch (e) {
            console.warn('Failed to load physical groups:', e);
        }
    }

    /**
     * Find which physical group (if any) a device belongs to.
     */
    findPhysicalGroup(portPath) {
        for (const group of this.physicalGroups) {
            if (group.members && group.members.includes(portPath)) {
                return group;
            }
        }
        return null;
    }

    getHubLabel(vendorId, productId, portPath) {
        // Check for port-specific label first (e.g., "05e3:0610@5-1")
        if (portPath) {
            const portKey = `${vendorId}:${productId}@${portPath}`;
            if (this.hubLabels[portKey]) {
                return this.hubLabels[portKey];
            }
        }
        // Fall back to vendor:product only (for backwards compatibility)
        const key = `${vendorId}:${productId}`;
        return this.hubLabels[key] || null;
    }

    getMotherboardLabel() {
        return this.hubLabels['motherboard'] || null;
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

        // Clear any previous errors - device reconnecting means it recovered
        device.errors = [];
        device.has_errors = false;

        // Mark as adding
        this.addingNodes.add(device.port_path);
        setTimeout(() => this.addingNodes.delete(device.port_path), 600);

        // Check if device already exists (could happen with quick reconnect)
        const existing = this.findDevice(device.port_path);
        if (existing) {
            // Update existing device data and clear errors (device recovered)
            existing.errors = [];
            existing.has_errors = false;
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
     * Collect all root hubs (host controllers) - they're all part of the motherboard.
     * Returns a single group containing all root hub nodes.
     */
    collectMotherboardHubs(rootNode) {
        if (!rootNode || !rootNode.children) return null;

        const rootHubs = [];

        // Each direct child of virtual root is a root hub (host controller)
        for (const rootHub of rootNode.children) {
            if (rootHub.data.is_root_hub || rootHub.data.port_path.startsWith('usb')) {
                rootHubs.push(rootHub);
            }
        }

        if (rootHubs.length === 0) return null;

        return {
            nodes: rootHubs,
            name: 'Motherboard USB Controllers',
            count: rootHubs.length
        };
    }

    /**
     * Calculate bounding box for motherboard group - all root hubs together
     */
    calculateMotherboardBounds(group, padding = 28) {
        if (!group || !group.nodes || group.nodes.length === 0) return null;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const node of group.nodes) {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        }

        // Check if we have a custom label - need more space if so
        const hasCustomLabel = !!this.getMotherboardLabel();
        const labelSpace = hasCustomLabel ? 30 : 18;

        return {
            x: minX - padding,
            y: minY - padding - labelSpace, // Extra space for label(s)
            width: (maxY - minY) + padding * 2,
            height: (maxX - minX) + padding * 2 + labelSpace,
            name: group.name,
            count: group.count
        };
    }

    /**
     * Detect learned physical groups - groups saved from the learning mode.
     * Returns groups with nodes that match the learned members.
     */
    detectLearnedGroups(rootNode) {
        if (!this.physicalGroups || this.physicalGroups.length === 0) {
            return [];
        }

        const groups = [];

        // Collect all nodes from the tree
        const allNodes = [];
        const collectNodes = (node) => {
            if (!node) return;
            if (node.data.port_path !== 'root') {
                allNodes.push(node);
            }
            if (node.children) {
                node.children.forEach(child => collectNodes(child));
            }
        };
        collectNodes(rootNode);

        // For each physical group, find matching nodes
        for (const physGroup of this.physicalGroups) {
            const matchingNodes = [];
            for (const portPath of physGroup.members || []) {
                const node = allNodes.find(n => n.data.port_path === portPath);
                if (node) {
                    matchingNodes.push(node);
                }
            }

            // Only create group if we found at least 2 members
            if (matchingNodes.length >= 2) {
                groups.push({
                    nodes: matchingNodes,
                    name: physGroup.name,
                    label: physGroup.label,
                    members: physGroup.members,
                    isLearned: true  // Flag to distinguish from heuristic groups
                });
            }
        }

        return groups;
    }

    /**
     * Calculate bounding box for a learned physical group.
     */
    calculateLearnedGroupBounds(group, padding = 24) {
        if (!group || !group.nodes || group.nodes.length === 0) return null;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const node of group.nodes) {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        }

        // Extra space for label(s)
        const labelSpace = group.label ? 32 : 20;

        return {
            x: minX - padding,
            y: minY - padding - labelSpace,
            width: (maxY - minY) + padding * 2,
            height: (maxX - minX) + padding * 2 + labelSpace,
            name: group.name,
            label: group.label,
            nodeCount: group.nodes.length
        };
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

        // Draw motherboard box around all root hubs (host controllers)
        const motherboardGroup = this.collectMotherboardHubs(root);
        if (motherboardGroup) {
            const bounds = this.calculateMotherboardBounds(motherboardGroup);
            if (bounds) {
                const bgColor = 'rgba(100, 116, 139, 0.06)';  // slate

                // Draw rounded rectangle around all root hubs
                const self = this;
                g.append('rect')
                    .attr('class', 'host-controller-group')
                    .attr('x', bounds.y)
                    .attr('y', bounds.x)
                    .attr('width', bounds.width)
                    .attr('height', bounds.height)
                    .attr('rx', 12)
                    .attr('ry', 12)
                    .attr('fill', bgColor)
                    .attr('stroke', bgColor.replace('0.06', '0.25'))
                    .attr('stroke-width', 1)
                    .style('cursor', 'pointer')
                    .on('click', function() {
                        const currentLabel = self.getMotherboardLabel();
                        self.showHubLabelModal('motherboard', 'Motherboard USB Controllers', currentLabel);
                    });

                // Add custom label (like airport code) if configured
                const customLabel = this.getMotherboardLabel();
                if (customLabel) {
                    g.append('text')
                        .attr('class', 'host-controller-label custom-label')
                        .attr('x', bounds.y + bounds.width / 2)
                        .attr('y', bounds.x + 14)
                        .attr('text-anchor', 'middle')
                        .attr('fill', 'var(--text-primary)')
                        .style('font-size', '12px')
                        .style('font-weight', 'bold')
                        .style('opacity', '0.8')
                        .text(customLabel);
                }

                // Add descriptive label below custom label or at top if no custom
                g.append('text')
                    .attr('class', 'host-controller-label')
                    .attr('x', bounds.y + bounds.width / 2)
                    .attr('y', bounds.x + (customLabel ? 26 : 12))
                    .attr('text-anchor', 'middle')
                    .attr('fill', 'var(--text-muted)')
                    .style('font-size', '9px')
                    .style('opacity', '0.6')
                    .text('Motherboard');
            }
        }

        // Detect and draw LEARNED physical groups first (they take priority)
        const learnedGroups = this.detectLearnedGroups(root);
        const learnedGroupColor = 'rgba(34, 197, 94, 0.10)';  // Green for learned/verified

        // Track which devices are in learned groups (to exclude from heuristic groups)
        const devicesInLearnedGroups = new Set();
        learnedGroups.forEach(group => {
            group.nodes.forEach(node => {
                devicesInLearnedGroups.add(node.data.port_path);
            });
        });

        learnedGroups.forEach((group, index) => {
            const bounds = this.calculateLearnedGroupBounds(group);
            if (bounds) {
                const self = this;
                const groupName = group.name || `Physical Group ${index + 1}`;

                // Draw solid rounded rectangle for learned group
                g.append('rect')
                    .attr('class', 'learned-group')
                    .attr('x', bounds.y)
                    .attr('y', bounds.x)
                    .attr('width', bounds.width)
                    .attr('height', bounds.height)
                    .attr('rx', 14)
                    .attr('ry', 14)
                    .attr('fill', learnedGroupColor)
                    .attr('stroke', 'rgba(34, 197, 94, 0.5)')  // Green solid border
                    .attr('stroke-width', 2)
                    .style('cursor', 'pointer')
                    .on('click', function() {
                        self.showLearnedGroupModal(group);
                    });

                // Add short label if configured
                if (group.label) {
                    g.append('text')
                        .attr('class', 'learned-group-label custom-label')
                        .attr('x', bounds.y + 10)
                        .attr('y', bounds.x + 16)
                        .attr('fill', 'var(--text-primary)')
                        .style('font-size', '12px')
                        .style('font-weight', 'bold')
                        .style('opacity', '0.9')
                        .text(group.label);
                }

                // Add group name
                g.append('text')
                    .attr('class', 'learned-group-label')
                    .attr('x', bounds.y + 10)
                    .attr('y', bounds.x + (group.label ? 30 : 16))
                    .attr('fill', 'rgba(34, 197, 94, 0.8)')
                    .style('font-size', '10px')
                    .style('font-weight', '500')
                    .text(`${groupName} (${bounds.nodeCount} devices)`);
            }
        });

        // Detect and draw heuristic physical hub groups (before links and nodes so they're behind)
        const hubGroups = this.detectHubGroups(root);
        const groupColors = ['rgba(59, 130, 246, 0.08)', 'rgba(168, 85, 247, 0.08)', 'rgba(34, 197, 94, 0.08)'];

        hubGroups.forEach((group, index) => {
            // Skip this heuristic group if all its devices are in learned groups
            const allInLearned = group.every(hub => devicesInLearnedGroups.has(hub.portPath));
            if (allInLearned) return;

            const bounds = this.calculateGroupBounds(group);
            if (bounds) {
                const colorIndex = index % groupColors.length;

                // Draw rounded rectangle for group
                // Use first hub's port path to create unique key for this specific hub group
                const firstHubPortPath = group[0].node.data.port_path;
                const hubKey = `${bounds.vendorId}:${group[0].node.data.product_id}@${firstHubPortPath}`;
                const hubDescription = `${bounds.vendorName} (${bounds.hubCount}-chip hub) @ ${firstHubPortPath}`;
                const self = this;

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
                    .attr('stroke-dasharray', '6,3')
                    .style('cursor', 'pointer')
                    .on('click', function() {
                        const currentLabel = self.getHubLabel(bounds.vendorId, group[0].node.data.product_id, firstHubPortPath);
                        self.showHubLabelModal(hubKey, hubDescription, currentLabel);
                    });

                // Get custom label for this hub (by vendor:product@port_path)
                const hubCustomLabel = this.getHubLabel(bounds.vendorId, group[0].node.data.product_id, firstHubPortPath);

                // Add custom label (like airport code) if configured
                if (hubCustomLabel) {
                    g.append('text')
                        .attr('class', 'hub-group-label custom-label')
                        .attr('x', bounds.y + 8)
                        .attr('y', bounds.x + 14)
                        .attr('fill', 'var(--text-primary)')
                        .style('font-size', '12px')
                        .style('font-weight', 'bold')
                        .style('opacity', '0.9')
                        .text(hubCustomLabel);
                }

                // Add descriptive label for the physical hub
                g.append('text')
                    .attr('class', 'hub-group-label')
                    .attr('x', bounds.y + 8)
                    .attr('y', bounds.x + (hubCustomLabel ? 26 : 16))
                    .attr('fill', 'var(--text-muted)')
                    .style('font-size', '10px')
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
            .on('click', (event, d) => this.handleNodeClick(d.data))
            .on('dblclick', (event, d) => {
                event.stopPropagation();
                this.handleNodeDoubleClick(d.data);
            })
            .style('pointer-events', 'all');

        // Node background circles
        nodes.append('circle')
            .attr('r', d => d.data.device_class === 'hub' ? 18 : 16)
            .attr('fill', d => this.colors[d.data.device_class] || this.colors.unknown)
            .attr('stroke', d => d.data.has_errors ? 'var(--error-color)' : 'rgba(255,255,255,0.3)')
            .attr('stroke-width', d => d.data.has_errors ? 2 : 1)
            .style('cursor', d => d.data.device_class === 'hub' && !d.data.is_root_hub ? 'pointer' : 'default');

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

    handleNodeClick(device, event) {
        // Update selection without full re-render (to preserve double-click)
        const prevSelected = this.selectedNode;
        this.selectedNode = device.port_path;

        // Just update CSS classes instead of full re-render
        this.svg.selectAll('.node')
            .classed('selected', d => d.data.port_path === this.selectedNode);

        // Show in info panel
        if (window.infoPanel) {
            window.infoPanel.showDevice(device);
        }
    }

    handleNodeDoubleClick(device) {
        // Only for hubs (not root hubs)
        if (device.device_class === 'hub' && !device.is_root_hub) {
            const key = `${device.vendor_id}:${device.product_id}@${device.port_path}`;
            const description = `${device.display_name} @ ${device.port_path}`;
            const currentLabel = this.getHubLabel(device.vendor_id, device.product_id, device.port_path);
            this.showHubLabelModal(key, description, currentLabel);
        }
    }

    showHubLabelModal(key, description, currentLabel) {
        const modal = document.getElementById('hub-label-modal');
        const infoEl = document.getElementById('hub-label-info');
        const input = document.getElementById('hub-label-input');
        const saveBtn = document.getElementById('hub-label-save-btn');
        const cancelBtn = document.getElementById('hub-label-cancel-btn');
        const learnBtn = document.getElementById('hub-learn-btn');
        const labelSection = document.getElementById('hub-label-section');
        const learnSection = document.getElementById('hub-learn-section');
        const learnStatus = document.getElementById('hub-learn-status');
        const learnProgress = document.getElementById('hub-learn-progress');
        const learnStopBtn = document.getElementById('hub-learn-stop-btn');
        const learnCancelBtn = document.getElementById('hub-learn-cancel-btn');
        const learnResult = document.getElementById('hub-learn-result');
        const learnDevices = document.getElementById('hub-learn-devices');
        const learnGuidance = document.getElementById('hub-learn-guidance');

        // Extract port_path from key (format: "vendor:product@port_path" or "motherboard")
        let portPath = null;
        if (key !== 'motherboard' && key.includes('@')) {
            portPath = key.split('@')[1];
        }

        infoEl.textContent = description;
        input.value = currentLabel || '';

        // Reset sections - show label section and save button, hide learn results
        labelSection.classList.remove('hidden');
        saveBtn.classList.remove('hidden');
        learnStatus.classList.remove('hidden');
        learnProgress.classList.add('hidden');
        learnResult.classList.add('hidden');
        learnGuidance.classList.remove('hidden');
        learnBtn.disabled = false;
        learnBtn.innerHTML = '<i data-lucide="unplug"></i> Start Detection';

        // Hide learn section for motherboard (can't test root hubs)
        if (key === 'motherboard') {
            learnSection.classList.add('hidden');
        } else {
            learnSection.classList.remove('hidden');
        }

        modal.classList.remove('hidden');
        lucide.createIcons();
        input.focus();
        input.select();

        let detectedGroup = null;
        let isLearning = false;
        const self = this;

        const handleSave = async () => {
            const label = input.value.trim();

            // If we detected a group, save it as a physical group
            if (detectedGroup) {
                if (!label) {
                    input.focus();
                    return;
                }

                try {
                    const response = await fetch('/api/physical-groups', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: label,
                            label: label,
                            members: detectedGroup.members
                        })
                    });

                    const result = await response.json();

                    if (result.success) {
                        if (window.app) {
                            window.app.addLogEntry('info', `Saved physical group: ${label}`);
                        }
                        await self.reloadPhysicalGroups();
                        window.usbSocket.refresh();
                    }
                } catch (error) {
                    console.error('Error saving physical group:', error);
                    if (window.app) {
                        window.app.addLogEntry('error', 'Failed to save physical group');
                    }
                }
            } else {
                // Just save the hub label
                try {
                    const response = await fetch('/api/hub-labels', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key, label })
                    });
                    if (response.ok) {
                        if (label) {
                            this.hubLabels[key] = label;
                        } else {
                            delete this.hubLabels[key];
                        }
                        this.render();
                    }
                } catch (e) {
                    console.error('Failed to save hub label:', e);
                }
            }
            closeModal();
        };

        // Start learning mode - monitor for physical disconnects
        const handleLearn = async () => {
            try {
                const response = await fetch('/api/learning/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                if (!response.ok) {
                    throw new Error('Failed to start learning mode');
                }

                isLearning = true;

                // Hide start button, show progress UI
                learnStatus.classList.add('hidden');
                learnGuidance.classList.add('hidden');
                learnProgress.classList.remove('hidden');
                lucide.createIcons();

                if (window.app) {
                    window.app.addLogEntry('info', 'Detection started - physically disconnect the hub now');
                }

            } catch (error) {
                console.error('Error starting detection:', error);
                if (window.app) {
                    window.app.addLogEntry('error', `Failed to start detection: ${error.message}`);
                }
            }
        };

        // Stop learning mode and get results
        const handleLearnStop = async () => {
            try {
                const response = await fetch('/api/learning/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ save: false })
                });

                if (!response.ok) {
                    throw new Error('Failed to stop learning mode');
                }

                const result = await response.json();
                isLearning = false;

                if (result.detected_group && result.detected_group.devices && result.detected_group.devices.length > 0) {
                    detectedGroup = result.detected_group;
                    const deviceCount = result.detected_group.devices.length;
                    const skippedCount = result.detected_group.skipped_existing?.length || 0;

                    // Show results with success header
                    let skippedNote = '';
                    if (skippedCount > 0) {
                        skippedNote = `<p class="hint" style="color: var(--text-muted);">(${skippedCount} hub${skippedCount !== 1 ? 's' : ''} already in other groups - excluded)</p>`;
                    }

                    learnDevices.innerHTML = `
                        <div class="learn-success">
                            <strong>✓ Detected ${deviceCount} hub${deviceCount !== 1 ? 's' : ''} in physical group:</strong>
                        </div>
                        ${result.detected_group.devices.map(d => `
                            <div class="device-item">
                                <span class="name">${escapeHtml(d.name)}</span>
                                <span class="path">${d.port_path}</span>
                            </div>
                        `).join('')}
                        ${skippedNote}
                        <p class="hint">Enter a name above and click "Save Group Name"</p>
                    `;

                    // Show label section for naming, hide progress
                    labelSection.classList.remove('hidden');
                    learnProgress.classList.add('hidden');
                    learnResult.classList.remove('hidden');
                    input.focus();
                    input.select();

                    if (window.app) {
                        window.app.addLogEntry('info', `Detected ${deviceCount} hubs in physical group`);
                    }
                } else {
                    // No devices detected
                    learnDevices.innerHTML = `
                        <div class="learn-error" style="color: var(--warning-color);">
                            <strong>No hubs detected</strong>
                            <p class="hint">Make sure you physically unplugged and reconnected the hub before stopping detection.</p>
                        </div>
                    `;
                    learnProgress.classList.add('hidden');
                    learnResult.classList.remove('hidden');
                    learnStatus.classList.remove('hidden');
                    learnGuidance.classList.remove('hidden');

                    if (window.app) {
                        window.app.addLogEntry('warning', 'No hubs detected during physical disconnect');
                    }
                }

            } catch (error) {
                console.error('Error stopping detection:', error);
                learnProgress.classList.add('hidden');
                learnStatus.classList.remove('hidden');
                learnGuidance.classList.remove('hidden');
                if (window.app) {
                    window.app.addLogEntry('error', `Failed to stop detection: ${error.message}`);
                }
            }
        };

        // Cancel learning mode without saving
        const handleLearnCancel = async () => {
            try {
                await fetch('/api/learning/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ save: false })
                });
            } catch (e) {
                // Ignore errors on cancel
            }
            isLearning = false;
            learnProgress.classList.add('hidden');
            learnStatus.classList.remove('hidden');
            learnGuidance.classList.remove('hidden');
        };

        const closeModal = async () => {
            // Stop learning mode if still active
            if (isLearning) {
                try {
                    await fetch('/api/learning/stop', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ save: false })
                    });
                } catch (e) {
                    // Ignore errors on close
                }
            }
            modal.classList.add('hidden');
            saveBtn.removeEventListener('click', handleSave);
            cancelBtn.removeEventListener('click', closeModal);
            learnBtn.removeEventListener('click', handleLearn);
            learnStopBtn.removeEventListener('click', handleLearnStop);
            learnCancelBtn.removeEventListener('click', handleLearnCancel);
            input.removeEventListener('keydown', handleKeydown);
        };

        const handleKeydown = (e) => {
            if (e.key === 'Escape') closeModal();
        };

        const escapeHtml = (text) => {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        saveBtn.addEventListener('click', handleSave);
        cancelBtn.addEventListener('click', closeModal);
        if (learnBtn) {
            learnBtn.addEventListener('click', handleLearn);
        }
        if (learnStopBtn) {
            learnStopBtn.addEventListener('click', handleLearnStop);
        }
        if (learnCancelBtn) {
            learnCancelBtn.addEventListener('click', handleLearnCancel);
        }
        input.addEventListener('keydown', handleKeydown);
    }

    showLearnedGroupModal(group) {
        const modal = document.getElementById('learned-group-modal');
        const infoEl = document.getElementById('learned-group-info');
        const membersEl = document.getElementById('learned-group-members');
        const nameInput = document.getElementById('learned-group-name');
        const saveBtn = document.getElementById('learned-group-save-btn');
        const deleteBtn = document.getElementById('learned-group-delete-btn');
        const cancelBtn = document.getElementById('learned-group-cancel-btn');

        const escapeHtml = (text) => {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        // Show group info
        infoEl.textContent = `${group.members.length} hub chips in this physical device`;
        nameInput.value = group.name || '';

        // Show members
        membersEl.innerHTML = group.nodes.map(node => `
            <div class="device-item">
                <span class="name">${escapeHtml(node.data.display_name)}</span>
                <span class="path">${node.data.port_path}</span>
            </div>
        `).join('');

        modal.classList.remove('hidden');
        nameInput.focus();
        nameInput.select();

        const self = this;

        const handleSave = async () => {
            const newName = nameInput.value.trim();
            if (!newName) {
                nameInput.focus();
                return;
            }

            try {
                const response = await fetch(`/api/physical-groups/${encodeURIComponent(group.name)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: newName
                    })
                });

                if (response.ok) {
                    if (window.app) {
                        window.app.addLogEntry('info', `Updated group: ${newName}`);
                    }
                    await self.loadPhysicalGroups();
                    self.render();
                }
            } catch (e) {
                console.error('Failed to update group:', e);
            }
            closeModal();
        };

        const handleDelete = async () => {
            if (!confirm(`Delete physical group "${group.name}"?`)) {
                return;
            }

            try {
                const response = await fetch(`/api/physical-groups/${encodeURIComponent(group.name)}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    if (window.app) {
                        window.app.addLogEntry('info', `Deleted group: ${group.name}`);
                    }
                    await self.loadPhysicalGroups();
                    self.render();
                }
            } catch (e) {
                console.error('Failed to delete group:', e);
            }
            closeModal();
        };

        const closeModal = () => {
            modal.classList.add('hidden');
            saveBtn.removeEventListener('click', handleSave);
            deleteBtn.removeEventListener('click', handleDelete);
            cancelBtn.removeEventListener('click', closeModal);
            nameInput.removeEventListener('keydown', handleKeydown);
        };

        const handleKeydown = (e) => {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'Enter') handleSave();
        };

        saveBtn.addEventListener('click', handleSave);
        deleteBtn.addEventListener('click', handleDelete);
        cancelBtn.addEventListener('click', closeModal);
        nameInput.addEventListener('keydown', handleKeydown);
    }

    selectDevice(portPath) {
        this.selectedNode = portPath;
        this.render();
    }

    clearSelection() {
        this.selectedNode = null;
        this.render();
    }

    /**
     * Reload physical groups from API and re-render.
     * Call this after saving a new learned group.
     */
    async reloadPhysicalGroups() {
        await this.loadPhysicalGroups();
    }
}

// Global instance
window.usbTree = new USBTree();
