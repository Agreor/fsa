// Synthetic source s1 fixture: every name, number and amount is invented. Only the layout is copied.
// Shape: what the PDF reader returns, each line also carries its items with x positions, so column information survives.
// text is the items sorted by x and joined with one space; rows are grouped by y within 2 units.
// Layout assumptions taken from one real sample: debits print as "-12,50"; a credit's sign is unknown, so the parser
// must accept "120,00" and "+120,00"; thousands separators were not seen, so the parser must also accept "1.234,50".
const item = (x, text) => ({ x, text });
const row = (y, ...items) => ({ y, items, text: items.map((i) => i.text).join(" ") });
const line = (y, text) => row(y, item(64, text));
const tx = (y, date, description, category, amount) => row(y, item(64, date), item(117, description), item(384, category), item(531, amount));

export const pages = [
  {
    lines: [
      line(800, "Extrait de compte Compte Exemple - EUR"),
      line(784, "Une question ? Voir l'aide en ligne"),
      line(729, "M TEST TITULAIRE"),
      line(705, "000-0000000-00"),
      line(695, "Extrait n° 1 Du 01/01/2026 au 31/01/2026"),
      line(683, "RUE EXEMPLE 1 Titulaire du compte"),
      line(672, "1000 VILLE"),
      line(669, "BE00 0000 0000 0000"), // pii-ok: all-zero placeholder
      line(657, "Ancien solde (EUR) Total des entrées (EUR)"),
      line(646, "345,67 120,00"),
      line(634, "Nouveau solde (EUR) Total des dépenses (EUR)"),
      line(623, "370,77 -94,90"),
      line(598, "Date Description Catégorie Montant (EUR)"),
      tx(581, "03-01-2026", "Virement en votre faveur n° 000000101", "Autre", "120,00"), // pii-ok: invented reference
      line(569, "De : Employeur Exemple"),
      line(557, "Communication : salaire de janvier"),
      tx(545, "05-01-2026", "Paiement par carte n° 000000102", "Shopping", "-45,20"), // pii-ok: invented reference
      line(533, "Shop Alpha 12 - Ville 1000 - Pays 05-01-2026"),
      tx(521, "05-01-2026", "Paiement par carte n° 000000103", "Shopping", "-45,20"), // pii-ok: invented reference
      line(509, "Shop Alpha 12 - Ville 1000 - Pays 05-01-2026"),
      tx(497, "12-01-2026", "Frais forfait mensuel n° 000000104", "Frais", "-4,50"), // pii-ok: invented reference
      line(485, "Pack de services Exemple"),
      line(72, "Exemple Banque S.A. - Adresse exemple 1 - 1000 Ville"),
      line(41, "Pour toute question, voir l'aide en ligne."),
      line(9, "Page 1 sur 2 + 370,77"),
    ],
  },
  {
    lines: [
      line(800, "Extrait de compte Compte Exemple - EUR"),
      line(770, "Titulaire du compte Numéro de compte"),
      line(755, "BE00 0000 0000 0000 Du 01/01/2026 au 31/01/2026"), // pii-ok: all-zero placeholder
      line(728, "Informations générales"),
      line(702, "Le forfait mensuel inclut :"),
      line(689, "- Un compte courant"),
      line(676, "- 5 retraits aux distributeurs de la zone euro"),
      line(663, "Les frais ne sont pas soumis à la TVA."),
      line(9, "Page 2 sur 2"),
    ],
  },
];

export const expected = {
  rows: [
    { date: "2026-01-03", description: "Virement en votre faveur De : Employeur Exemple Communication : salaire de janvier", amount: 12000, currency: "EUR", account: "a1", occurrence: 1, sourceId: "000000101" }, // pii-ok: invented reference
    { date: "2026-01-05", description: "Paiement par carte Shop Alpha 12 - Ville 1000 - Pays 05-01-2026", amount: -4520, currency: "EUR", account: "a1", occurrence: 1, sourceId: "000000102" }, // pii-ok: invented reference
    { date: "2026-01-05", description: "Paiement par carte Shop Alpha 12 - Ville 1000 - Pays 05-01-2026", amount: -4520, currency: "EUR", account: "a1", occurrence: 1, sourceId: "000000103" }, // pii-ok: invented reference
    { date: "2026-01-12", description: "Frais forfait mensuel Pack de services Exemple", amount: -450, currency: "EUR", account: "a1", occurrence: 1, sourceId: "000000104" }, // pii-ok: invented reference
  ],
  coverage: { from: "2026-01-01", to: "2026-01-31" },
  balances: [
    { currency: "EUR", asOf: "2025-12-31", amount: 34567 },
    { currency: "EUR", asOf: "2026-01-31", amount: 37077 },
  ],
};
