// Quote every cell and neutralize spreadsheet formulas in user-entered text.
export function encodeCsv(rows: (string | number)[][]): string {
    return rows.map(row => row.map(value => {
        const text = String(value);
        const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
        return '"' + safe.replace(/"/g, '""') + '"';
    }).join(",")).join("\r\n");
}
