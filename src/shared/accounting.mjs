// Generated from src/accounting.ts. Run npm run build:domain.
export function outgoingMigration(entry) {
	return entry.nextMigration || (entry.migration?.sourceId === entry.id ? entry.migration : undefined);
}
export function ticketHistory(entry, entries) {
	const byId = new Map(entries.map((item) => [item.id, item]));
	const seen = new Set();
	let root = entry;
	while (root.migration && root.migration.sourceId !== root.id) {
		if (seen.has(root.id)) throw Error("Invalid ticket migration cycle.");
		seen.add(root.id);
		const parent = byId.get(root.migration.sourceId);
		if (!parent) throw Error("Ticket migration history is incomplete.");
		root = parent;
	}
	const history = [];
	seen.clear();
	let current = root;
	while (current) {
		if (seen.has(current.id)) throw Error("Invalid ticket migration cycle.");
		seen.add(current.id);
		history.push(current);
		const link = outgoingMigration(current);
		if (!link) break;
		current = byId.get(link.saleId);
		if (!current) throw Error("Ticket migration history is incomplete.");
	}
	return history;
}
export function originalTicketCost(entry, entries) {
	// Display-only cost survives agency/date filtering without rewriting stored history.
	if ("resolvedTicketCost" in entry) return entry.resolvedTicketCost ?? undefined;
	// Display ledgers resolve costs before agency/date filtering.
	if (entry.migration && entry.migration.sourceId !== entry.id) {
		const parent = entries.find((item) => item.id === entry.migration.sourceId);
		if (parent?.type === "payment") return entry.ticketCost;
		if (!parent) return undefined;
	}
	return ticketHistory(entry, entries)[0]?.ticketCost;
}
export function transactionLedgerNarration(transaction, agency) {
	if (transaction.reversalOf) return transaction.narration || "Reversal";
	const isTicket = transaction.type === "sale" || outgoingMigration(transaction);
	if (!isTicket) return transaction.narration || "Payment received";
	const date = (value) => value.split("-").reverse().join("-");
	const airline = transaction.airlineName?.trim();
	const details = `Ref No : ${transaction.reference || "-"}, Ticket No. ${transaction.ticket || "-"} Sector: ${transaction.sector || "-"}${airline ? `, Airline: ${airline}` : ""}, Voucher No. ${transaction.voucher} to ${agency.name} on ${date(transaction.date)}, Flight Date : ${transaction.flightDate ? date(transaction.flightDate) : "-"}, Pax Name : ${transaction.passenger || "-"}, Ticket sales amount: BDT ${(transaction.amount / 100).toFixed(2)}`;
	return transaction.narration ? `${details}, Notes: ${transaction.narration}` : details;
}
// Keep the original debit and its separate migration credit on their posting dates.
// Resolve purchase costs before filtering so destination profit retains its history.
export function mergeMigratedEntries(entries) {
	return entries.map((entry) => {
		if (entry.type !== "sale" || !entry.migration) return entry;
		const cost = originalTicketCost(entry, entries);
		return {
			...entry,
			ticketCost: cost,
			resolvedTicketCost: cost ?? null
		};
	});
}
export function activeLedgerRecords(agencies, transactions) {
	const visibleAgencies = agencies.filter((agency) => !agency.archivedAt);
	const ids = new Set(visibleAgencies.map((agency) => agency.id));
	return {
		agencies: visibleAgencies,
		transactions: mergeMigratedEntries(transactions).filter((entry) => !entry.archivedAt && ids.has(entry.agencyId))
	};
}
export function ticketProfit(entry) {
	if (entry.type !== "sale" || entry.reversalOf || outgoingMigration(entry) || entry.ticketCost === undefined) return null;
	assertMinor(entry.amount);
	assertMinor(entry.ticketCost, true);
	return entry.amount - entry.ticketCost;
}
/** Tax refunds are credit entries classified using the existing payment method field. */
export function isTaxRefund(entry) {
	return entry.type === "payment" && entry.method === "Tax Refund";
}
export function profitSummary(entries, allEntries = entries) {
	let total = 0, missingCosts = 0;
	const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
	for (const entry of entries) {
		const original = entry.reversalOf ? byId.get(entry.reversalOf) : entry;
		if (original && isTaxRefund(original)) {
			assertMinor(original.amount);
			total = safeAdd(total, entry.reversalOf ? original.amount : -original.amount);
			continue;
		}
		if (!original || original.type !== "sale" || original.reversalOf || outgoingMigration(original)) continue;
		const profit = ticketProfit({
			...original,
			ticketCost: originalTicketCost(original, allEntries)
		});
		if (profit === null) {
			missingCosts++;
			continue;
		}
		total = safeAdd(total, entry.reversalOf ? -profit : profit);
	}
	return {
		total,
		missingCosts
	};
}
export function parseMoney(input, allowZero = false) {
	const value = input.trim();
	if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid amount with at most two decimal places.");
	const [whole, fraction = ""] = value.split(".");
	const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
	if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large.");
	if (!allowZero && minor === 0n) throw new Error("Amount must be greater than zero.");
	return Number(minor);
}
export function assertMinor(value, allowZero = false) {
	if (!Number.isSafeInteger(value) || value < 0 || !allowZero && value === 0) throw new Error("Invalid monetary amount. Check this record before saving.");
}
export function safeAdd(a, b) {
	const result = a + b;
	if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(result)) throw new Error("Balance exceeds the supported precision.");
	return result;
}
export function validDate(value) {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function balanceMeta(value) {
	return {
		value: Math.abs(value),
		side: value > 0 ? "Dr" : value < 0 ? "Cr" : "—"
	};
}
export function openingBalance(agency) {
	assertMinor(agency.opening, true);
	if (agency.openingSide !== "Dr" && agency.openingSide !== "Cr") throw new Error("Invalid opening balance side.");
	return agency.openingSide === "Dr" ? agency.opening : -agency.opening;
}
export function movement(entry) {
	assertMinor(entry.amount);
	if (entry.type !== "sale" && entry.type !== "payment") throw new Error("Invalid transaction type.");
	return entry.type === "sale" ? entry.amount : -entry.amount;
}
export function getBalance(agency, entries) {
	return entries.filter((entry) => entry.agencyId === agency.id).reduce((balance, entry) => safeAdd(balance, movement(entry)), openingBalance(agency));
}
export function compareLedgerEntries(a, b) {
	return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}
export function calculateLedger(agency, entries, from, to) {
	if (!validDate(from) || !validDate(to) || from > to) throw new Error("Select a valid date range: From must be on or before To.");
	if (agency.openingDate && from < agency.openingDate) throw new Error(`Statement starts before the opening balance date (${agency.openingDate}). Select this date or later.`);
	const ordered = mergeMigratedEntries(entries).filter((entry) => entry.agencyId === agency.id).sort(compareLedgerEntries);
	let running = openingBalance(agency);
	for (const entry of ordered.filter((entry) => entry.date < from)) running = safeAdd(running, movement(entry));
	const opening = running;
	let totalDebit = 0, totalCredit = 0;
	const rows = ordered.filter((entry) => entry.date >= from && entry.date <= to).map((t) => {
		running = safeAdd(running, movement(t));
		if (t.type === "sale") totalDebit = safeAdd(totalDebit, t.amount);
		else totalCredit = safeAdd(totalCredit, t.amount);
		return {
			t,
			running
		};
	});
	return {
		opening,
		closing: running,
		rows,
		totalDebit,
		totalCredit
	};
}
export function ledgerDateWindow(today) {
	if (!validDate(today)) throw Error("Invalid current date.");
	const shift = (offset) => {
		const year = Number(today.slice(0, 4)) + offset;
		const candidate = `${year}${today.slice(4)}`;
		return validDate(candidate) ? candidate : `${year}-02-28`;
	};
	return {
		from: shift(-1),
		to: shift(1)
	};
}
export function completeLedger(agency, entries, today) {
	const dates = mergeMigratedEntries(entries).filter((entry) => entry.agencyId === agency.id).map((entry) => entry.date).sort();
	const from = agency.openingDate || dates[0] || today;
	const to = dates.length ? dates[dates.length - 1] > from ? dates[dates.length - 1] : from : from;
	return {
		...calculateLedger(agency, entries, from, to),
		from,
		to
	};
}
export function validateEntry(entry, agencies, entries, editing = false) {
	movement(entry);
	if (entry.ticketCost !== undefined) {
		if (entry.type !== "sale") throw new Error("Ticket cost is only valid for ticket sales.");
		assertMinor(entry.ticketCost, true);
	}
	if (!validDate(entry.date)) throw new Error("Select a valid posting date.");
	if (!entry.voucher.trim()) throw new Error("Voucher number is required.");
	if (!agencies.some((agency) => agency.id === entry.agencyId)) throw new Error("Select an existing agency.");
	if (editing && !entries.some((item) => item.id === entry.id)) throw new Error("This entry no longer exists. Refresh before editing.");
	if (!editing && entries.some((item) => item.id === entry.id)) throw new Error("This entry has already been saved.");
	if (entries.some((item) => (!editing || item.id !== entry.id) && item.voucher.trim().toLowerCase() === entry.voucher.trim().toLowerCase())) throw new Error("This voucher number already exists. Use a unique voucher number.");
	const next = editing ? entries.map((item) => item.id === entry.id ? entry : item) : [...entries, entry];
	agencies.forEach((agency) => getBalance(agency, next));
}
export function canDeleteAgency(agency, entries) {
	return agency.opening === 0 && !entries.some((entry) => entry.agencyId === agency.id);
}
export function amountInWords(value) {
	assertMinor(value, true);
	const units = [
		"Zero",
		"One",
		"Two",
		"Three",
		"Four",
		"Five",
		"Six",
		"Seven",
		"Eight",
		"Nine",
		"Ten",
		"Eleven",
		"Twelve",
		"Thirteen",
		"Fourteen",
		"Fifteen",
		"Sixteen",
		"Seventeen",
		"Eighteen",
		"Nineteen"
	];
	const tens = [
		"",
		"",
		"Twenty",
		"Thirty",
		"Forty",
		"Fifty",
		"Sixty",
		"Seventy",
		"Eighty",
		"Ninety"
	];
	const words = (number) => {
		if (number < 20) return units[number];
		for (const [divisor, label] of [
			[1e7, "Crore"],
			[1e5, "Lakh"],
			[1e3, "Thousand"],
			[100, "Hundred"]
		]) {
			if (number >= divisor) return `${words(Math.floor(number / divisor))} ${label}${number % divisor ? ` ${words(number % divisor)}` : ""}`;
		}
		return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${units[number % 10]}` : ""}`;
	};
	return `${words(Math.floor(value / 100))} Taka${value % 100 ? ` and ${words(value % 100)} Paisa` : ""} only`;
}
export function validatePaymentDetails(entry) {
	if (entry.type !== "payment") return;
	if (entry.method === "Bank Transfer") {
		if (!entry.sendingBank?.trim() || !entry.receivingBank?.trim()) throw new Error("Select both sending and receiving banks.");
		if (entry.sendingBank === "Other Bank" && !entry.sendingBankName?.trim() || entry.receivingBank === "Other Bank" && !entry.receivingBankName?.trim()) throw new Error("Enter the other bank name.");
	}
	if (entry.method === "Cheque" && (!entry.chequeNumber?.trim() || !validDate(entry.chequeDate || ""))) throw new Error("Enter a cheque number and valid cheque date.");
	if ([
		"Nagad",
		"bKash",
		"Rocket"
	].includes(entry.method || "") && !entry.walletNumber?.trim()) throw new Error("Enter the mobile wallet number.");
}
