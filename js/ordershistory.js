// Part of RealityTracker Demo Analyser - Copyright (C) 2026 [KKCK] AlcatraZ.jpg
// Licensed under the GNU General Public License v3.0 (GPL-3.0), see LICENSE

"use strict";

// OrdersHistory  -  Persistent history of all Squad Leader orders (Orders)
//
// AllSLOrders in parser.js only stores the latest active order per squad.
// OrdersHistoryBuffer maintains a chronological log of all orders emitted
// throughout the match to support order-age and spotted tracking.

class OrdersHistoryBuffer {
	constructor() {
		this.orders = [];
		this.nextId = 1;
	}

	invalidate() {
		this.orders.length = 0;
		this.nextId = 1;
	}

	recordOrder(orderObj) {
		if (!orderObj || orderObj.type === -1) return;

		this.orders.push({
			id: this.nextId++,
			tick: Tick_Current,
			team: orderObj.team,
			squad: orderObj.squad,
			type: orderObj.type,
			X: orderObj.X,
			Y: orderObj.Y,
			Z: orderObj.Z
		});
	}

	getAllOrders() {
		return this.orders;
	}
}

var ordersHistory = new OrdersHistoryBuffer();
