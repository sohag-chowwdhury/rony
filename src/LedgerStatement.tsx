import { jsPDF } from "jspdf";

export type StatementData = {
    account: string;
    from: string;
    to: string;
    opening: number;
    totalDebit?: number;
    totalCredit?: number;
    rows: { date: string; voucher: string; narration: string; method: string; debit: number; credit: number; balance: number }[];
};
type TextItem = { kind: "text"; x: number; y: number; text: string; size: number; font: "times" | "courier"; style: "normal" | "bold" | "italic"; align: "left" | "right" | "center" };
type Rule = { kind: "rule"; y: number; dotted: boolean };
type Page = (TextItem | Rule)[];
const dateLabel = (value: string) => value.split("-").reverse().join("-");
const amount = (value: number, decimals = false) => (Math.abs(value) / 100).toLocaleString("en-US", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 });
const balance = (value: number) => `${amount(value, true)} ${value < 0 ? "Cr" : value > 0 ? "Dr" : "-"}`;

// Paginated layout for the downloaded ledger PDF.
function layoutStatement(data: StatementData) {
    const measure = new jsPDF({ unit: "mm", format: "a4" });
    const pages: Page[] = [[]];
    let page = pages[0];
    let y = 0;
    const text = (value: string, x: number, baseline: number, size = 8, font: TextItem["font"] = "courier", style: TextItem["style"] = "normal", align: TextItem["align"] = "left") => {
        page.push({ kind: "text", text: value, x, y: baseline, size, font, style, align });
    };
    const rule = (baseline: number, dotted = false) => page.push({ kind: "rule", y: baseline, dotted });
    const wrap = (value: string, width: number, font: TextItem["font"] = "courier", size = 8): string[] => {
        measure.setFont(font, "normal");
        measure.setFontSize(size);
        return measure.splitTextToSize(value || "", width);
    };
    const columns = (top: number) => {
        rule(top);
        text("Voucher No", 7, top + 4, 8, "courier", "bold");
        text("Narration", 29, top + 4, 8, "courier", "bold");
        text("Payment Mode", 102, top + 4, 8, "courier", "bold");
        text("Debit", 148, top + 4, 8, "courier", "bold", "right");
        text("Credit", 170, top + 4, 8, "courier", "bold", "right");
        text("Balance", 202, top + 4, 8, "courier", "bold", "right");
        rule(top + 6);
        y = top + 7;
    };
    const nextPage = () => { page = []; pages.push(page); columns(7); };
    const headingCenter = measure.internal.pageSize.getWidth() / 2;
    text("A TO Z AIR TRAVELS", headingCenter, 12, 12, "times", "bold", "center");
    text("General Ledger", headingCenter, 17, 11, "times", "bold", "center");
    const accountLines = wrap(data.account, 117, "times", 9);
    text("Account Name   :", 7, 28, 9, "times");
    accountLines.forEach((line, index) => text(line, 30, 28 + index * 4, 9, "times"));
    text("Printed By    :  ADMIN", 160, 28, 9, "times");
    const periodY = 28 + accountLines.length * 4 + 1;
    text("Period              :", 7, periodY, 9, "times");
    text(`${dateLabel(data.from)} to ${dateLabel(data.to)}`, 30, periodY, 9, "times");
    text("User ID        :  admin", 160, periodY, 9, "times");
    columns(periodY + 10);

    const drawRow = (cells: string[], date?: string) => {
        const widths = [20, 69, 27, 20, 20, 31];
        const lines = cells.map((value, index) => wrap(value, widths[index]));
        const count = Math.max(1, ...lines.map((cell) => cell.length));
        const height = Math.max(9, count * 3 + 2);
        const dateHeight = date ? 7 : 0;
        // Keep a date heading with its entry; move normal entries as a whole.
        if (y + dateHeight + Math.min(height, 260) > 279) nextPage();
        if (date) { text(dateLabel(date), 6, y + 4, 8.5, "courier", "bold"); y += 7; }
        let offset = 0;
        while (offset < count) {
            const capacity = Math.max(1, Math.floor((279 - y - 2) / 3));
            const take = Math.min(count - offset, capacity);
            const blockHeight = Math.max(9, take * 3 + 2);
            const positions = [7, 29, 102, 148, 170, 202];
            lines.forEach((cell, column) => {
                const visible = cell.slice(offset, offset + take);
                const top = y + 3 + (offset === 0 && cell.length === 1 ? Math.max(0, (blockHeight - 5) / 2) : 0);
                visible.forEach((line, index) => text(line, positions[column], top + index * 3, 8, "courier", "normal", column >= 3 ? "right" : "left"));
            });
            y += blockHeight;
            offset += take;
            rule(y, true);
            if (offset < count) nextPage();
        }
    };
    if (data.opening !== 0) drawRow(["", "Opening balance", "", "", "", balance(data.opening)], data.from);
    let previousDate = "";
    for (const row of data.rows) {
        drawRow([row.voucher, row.narration, row.method, row.debit ? amount(row.debit) : "", row.credit ? amount(row.credit) : "", balance(row.balance)], row.date !== previousDate ? row.date : undefined);
        previousDate = row.date;
    }
    if (!data.rows.length) drawRow(["", "No transactions in this period", "", "", "", balance(data.opening)]);
    // Add the report totals once, after all transaction pages are laid out.
    // Keep the totals and end marker together above the page footer.
    if (y + 25 > 279) nextPage();
    const totalDebit = data.totalDebit ?? data.rows.reduce((sum, row) => sum + row.debit, 0);
    const totalCredit = data.totalCredit ?? data.rows.reduce((sum, row) => sum + row.credit, 0);
    const closing = data.rows.length ? data.rows[data.rows.length - 1].balance : data.opening;
    rule(y);
    text("Total Closing Balance :", 118, y + 4, 8, "courier", "bold", "right");
    text(amount(totalDebit), 148, y + 4, 8, "courier", "bold", "right");
    text(amount(totalCredit), 170, y + 4, 8, "courier", "bold", "right");
    text(balance(closing), 202, y + 4, 8, "courier", "bold", "right");
    rule(y + 7);
    text("*** End of the Report ***", headingCenter, y + 24, 8, "courier", "bold", "center");
    const stamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka", hour12: true, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
    pages.forEach((current, index) => {
        page = current;
        text(`${stamp} (UTC+06:00)`, 6, 289, 8, "courier", "italic");
        text(`Page ${index + 1} of ${pages.length}`, 190, 289, 8, "courier", "italic", "right");
    });
    return pages;
}

export function createLedgerPdf(data: StatementData, _logoDataUrl?: string) {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setProperties({ title: `${data.account} - General Ledger`, author: "A TO Z AIR TRAVELS" });
    layoutStatement(data).forEach((page, index) => {
        if (index) pdf.addPage();
        page.forEach((item) => {
            if (item.kind === "rule") {
                pdf.setDrawColor(item.dotted ? 180 : 160);
                pdf.setLineWidth(0.15);
                pdf.setLineDashPattern(item.dotted ? [0.15, 1.2] : [], 0);
                pdf.line(6, item.y, 204, item.y);
            } else {
                pdf.setTextColor(0);
                pdf.setFont(item.font, item.style);
                pdf.setFontSize(item.size);
                pdf.text(item.text, item.x, item.y, { align: item.align });
            }
        });
    });
    return pdf;
}
