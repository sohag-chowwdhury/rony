import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { personalTotals, type PersonalEntry, type PersonalPayment } from './personalAccounting';

export const personalPersonKey = (person: string) => person.trim().toLowerCase();

export function personalPdfEntries(entries: PersonalEntry[], person?: string) {
    return entries.filter(entry => !entry.deleted && (person === undefined || personalPersonKey(entry.person) === personalPersonKey(person)))
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function createPersonalLedgerPdf(entries: PersonalEntry[], person?: string, payments: Record<string, PersonalPayment[]> = {}) {
    const rows = personalPdfEntries(entries, person);
    if (!rows.length) throw Error('No personal entries available for this PDF.');
    const totals = personalTotals(rows);
    const amount = (value: number) => (value / 100).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const title = person === undefined ? 'Personal ledger - Full report' : 'Personal ledger - Person report';
    pdf.setProperties({ title });
    pdf.setFontSize(18);
    pdf.setTextColor(17, 57, 54);
    pdf.text(title, 14, 18);
    pdf.setFontSize(10);
    const scope = pdf.splitTextToSize(person === undefined ? 'All people' : `Person: ${person.trim()}`, 269);
    pdf.text(scope, 14, 26);
    const summaryY = 29 + scope.length * 5;
    let summaryEnd = summaryY + 12;
    pdf.setFontSize(9);
    pdf.text(`Generated: ${new Date().toLocaleString('en-GB')} | ${rows.length} entries | Currency: BDT`, 14, summaryY);
    pdf.text(`Outstanding to receive: ${amount(totals.receivable)}    |    Outstanding to pay: ${amount(totals.payable)}`, 14, summaryY + 7);
    autoTable(pdf, {
        startY: summaryY + 12,
        margin: { top: 14, right: 14, bottom: 18, left: 14 },
        head: [['Date', 'Person', 'Reason / Purpose', 'Type', 'Original (BDT)', 'Repaid (BDT)', 'Outstanding (BDT)']],
        body: rows.map((entry, index) => [entry.date, entry.person, `#${index + 1}\n${entry.reason}`, entry.direction === 'receivable' ? 'To receive' : 'To pay', amount(entry.amount), amount(entry.paid), amount(entry.amount - entry.paid)]),
        styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [17, 57, 54] },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 38 }, 2: { cellWidth: 72 }, 3: { cellWidth: 24 }, 4: { halign: 'right', cellWidth: 35 }, 5: { halign: 'right', cellWidth: 35 }, 6: { halign: 'right', cellWidth: 41 } },
        didDrawPage: ({ cursor }) => { summaryEnd = cursor?.y ?? summaryEnd; },
    });
    let historyY = summaryEnd + 12;
    if (historyY + 48 > 192) {
        pdf.addPage();
        historyY = 18;
    }
    pdf.setFontSize(16);
    pdf.setTextColor(17, 57, 54);
    pdf.text('Repayment history', 14, historyY);
    pdf.setFontSize(9);
    pdf.text('Payment dates are shown as recorded. Exact payment times were not stored.', 14, historyY + 8);
    pdf.text('Entry numbers refer to the summary above. All amounts are in BDT.', 14, historyY + 14);
    const historyRows = rows.flatMap((entry, index) => {
        const history = [...(payments[entry.id] || [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        const reference = `#${index + 1} | ${entry.date}\n${entry.reason}`;
        if (!history.length) return [[reference, entry.person, '-', '-', '-', entry.paid ? 'Repayment history unavailable for this entry.' : 'No repayments recorded.']];
        return history.map(payment => [reference, entry.person, payment.date, entry.direction === 'receivable' ? 'Received' : 'Paid', amount(payment.amount), payment.note || '-']);
    });
    autoTable(pdf, {
        startY: historyY + 20,
        margin: { top: 14, right: 14, bottom: 18, left: 14 },
        head: [['Original entry / Purpose', 'Person', 'Payment date', 'Payment type', 'Amount (BDT)', 'Payment note']],
        body: historyRows,
        styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [17, 57, 54] },
        columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 38 }, 2: { cellWidth: 28 }, 3: { cellWidth: 26 }, 4: { cellWidth: 35, halign: 'right' }, 5: { cellWidth: 70 } },

    });
    for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.setTextColor(90);
        pdf.text(`Personal ledger | Page ${page} of ${pdf.getNumberOfPages()}`, 283, 202, { align: 'right' });
    }
    return pdf;
}