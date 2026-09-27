export function agencyContactLinks(phone: string) {
    const cleaned = phone.trim().replace(/[\s().-]/g, "");
    if (!/^\+?\d+$/.test(cleaned)) return null;
    let digits = cleaned.replace(/^\+/, "").replace(/^00/, "");
    // Bangladesh local mobile numbers use +880 for international links.
    if (/^01\d{9}$/.test(digits)) digits = "880" + digits.slice(1);
    if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
    return { call: "tel:+" + digits, whatsapp: "https://wa.me/" + digits };
}
