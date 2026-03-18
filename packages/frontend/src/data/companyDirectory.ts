export interface CompanyEntry {
  name: string;
  phone: string;
  category: string;
}

export const companyDirectory: Array<CompanyEntry> = [
  { name: 'Amazon', phone: '+18004464276', category: 'Retail' },
  { name: 'Apple', phone: '+18002752273', category: 'Tech' },
  { name: 'AT&T', phone: '+18002882020', category: 'Telecom' },
  { name: 'Bank of America', phone: '+18004321000', category: 'Banking' },
  { name: 'Capital One', phone: '+18002271110', category: 'Banking' },
  { name: 'Chase', phone: '+18009359935', category: 'Banking' },
  { name: 'Comcast / Xfinity', phone: '+18009346489', category: 'Telecom' },
  { name: 'Delta Airlines', phone: '+18002211212', category: 'Travel' },
  { name: 'eBay', phone: '+18663226229', category: 'Retail' },
  { name: 'FedEx', phone: '+18004633339', category: 'Shipping' },
  { name: 'Google', phone: '+18555318000', category: 'Tech' },
  { name: 'Medicare', phone: '+18006334227', category: 'Government' },
  { name: 'Microsoft', phone: '+18006427676', category: 'Tech' },
  { name: 'PayPal', phone: '+18882211161', category: 'Finance' },
  { name: 'Social Security', phone: '+18007721213', category: 'Government' },
  { name: 'Southwest Airlines', phone: '+18004359792', category: 'Travel' },
  { name: 'T-Mobile', phone: '+18009378997', category: 'Telecom' },
  { name: 'United Airlines', phone: '+18008648331', category: 'Travel' },
  { name: 'UPS', phone: '+18007425877', category: 'Shipping' },
  { name: 'Verizon', phone: '+18009220204', category: 'Telecom' },
  { name: 'Wells Fargo', phone: '+18008693557', category: 'Banking' },
];
