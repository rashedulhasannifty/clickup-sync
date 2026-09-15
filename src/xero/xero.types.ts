export interface XeroTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

export interface XeroTenantConnection {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string | null;
}

export interface XeroOrganisation {
  Name: string;
  BaseCurrency: string;
  ShortCode?: string;
}

export interface XeroContactRef {
  ContactID?: string;
  Name?: string;
}

export interface XeroLineItem {
  LineItemID?: string;
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  AccountCode?: string;
  TaxType?: string;
  TaxAmount?: number;
  LineAmount?: number;
  ItemCode?: string;
}

export interface XeroPhone {
  PhoneType?: string;
  PhoneNumber?: string;
  PhoneAreaCode?: string;
  PhoneCountryCode?: string;
}

export interface XeroAddress {
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  Region?: string;
  PostalCode?: string;
  Country?: string;
}

export interface XeroContact {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  Phones?: XeroPhone[];
  Addresses?: XeroAddress[];
  TaxNumber?: string;
  DefaultCurrency?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  ContactStatus?: string;
  UpdatedDateUTC: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  Type: string;
  InvoiceNumber?: string;
  Reference?: string;
  Contact?: XeroContactRef;
  Status: string;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
  LineItems?: XeroLineItem[];
  HasAttachments?: boolean;
  UpdatedDateUTC: string;
}

export interface XeroCreditNote {
  CreditNoteID: string;
  Type: string;
  CreditNoteNumber?: string;
  Reference?: string;
  Contact?: XeroContactRef;
  Status: string;
  Date?: string;
  DateString?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  RemainingCredit?: number;
  LineItems?: XeroLineItem[];
  HasAttachments?: boolean;
  UpdatedDateUTC: string;
}

export interface XeroBankTransaction {
  BankTransactionID: string;
  Type: string;
  Contact?: XeroContactRef;
  BankAccount?: { AccountID?: string; Code?: string; Name?: string };
  Reference?: string;
  Status: string;
  IsReconciled?: boolean;
  Date?: string;
  DateString?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  LineItems?: XeroLineItem[];
  HasAttachments?: boolean;
  UpdatedDateUTC: string;
}

export interface XeroPayment {
  PaymentID: string;
  PaymentType?: string;
  Status: string;
  Date?: string;
  Amount?: number;
  CurrencyRate?: number;
  Reference?: string;
  Account?: { AccountID?: string; Code?: string; Name?: string };
  Invoice?: { InvoiceID?: string; InvoiceNumber?: string; Type?: string; Contact?: XeroContactRef; CurrencyCode?: string };
  CreditNote?: { CreditNoteID?: string; CreditNoteNumber?: string; Contact?: XeroContactRef; CurrencyCode?: string };
  UpdatedDateUTC: string;
}

export interface XeroAttachment {
  AttachmentID: string;
  FileName: string;
  MimeType?: string;
  ContentLength?: number;
}
