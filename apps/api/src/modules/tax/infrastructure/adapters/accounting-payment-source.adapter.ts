// WHT events are sourced from ExpenseRecord (expense-source.adapter.ts) and from settled supplier
// payments (supplier-payment-source.adapter.ts).
//
// AccountingPayment deliberately produces none. Its whtAmount is tax a CUSTOMER withheld from us:
// we are the payee there, so the obligation to file ภ.ง.ด. and issue the 50 ทวิ is theirs, not
// ours. That amount is a tax credit — it belongs in the ledger and eventually in CIT, never in a
// WHT event of ours.
export {};
