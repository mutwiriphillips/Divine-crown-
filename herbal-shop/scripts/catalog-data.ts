/**
 * Draft catalogue built from the owner's photos (seed-photos/). Every entry starts as a DRAFT that
 * needs review: names are copied from the packaging as closely as it can be read; anything that couldn't
 * be confirmed from the photo is left empty and explained in reviewNotes.
 *
 * Prices: only two prices appear in the photos (as text overlays the owner added). They are seeded and
 * flagged for confirmation. All other prices, costs, stock, suppliers, ingredients and SKUs are left blank.
 *
 * Crops are fractions of the original photo, used when one photo shows several products. They're
 * non-destructive and can be changed in Admin → Products → Images.
 */

export type SeedImage = { file: string; crop?: [number, number, number, number]; alt: string };

export type SeedProduct = {
  key: string;
  name: string;
  brand: string | null;
  category: string; // category slug
  productType: "COSMETIC" | "HOUSEHOLD" | "TRADITIONAL_SPIRITUAL" | "INCENSE_FRAGRANCE" | "HERBAL_CONSUMABLE" | "BUNDLE" | "OTHER";
  variantName: string;
  priceKES?: number;
  labelTranscript: string;
  reviewNotes: string;
  warnings?: string;
  shippingRestriction?: string;
  trackBatches?: boolean;
  images: SeedImage[];
  bundleOf?: { key: string; qty: number }[];
};

export const CATEGORIES = [
  { slug: "oils", name: "Oils", description: "Traditional and fragrance oils.", sortOrder: 1 },
  { slug: "soaps", name: "Soaps", description: "Bar soaps.", sortOrder: 2 },
  { slug: "powders-bukhoor", name: "Powders & bukhoor", description: "Powders and bukhoor for burning or bathing.", sortOrder: 3 },
  { slug: "incense", name: "Incense", description: "Incense sticks and incense oils.", sortOrder: 4 },
  { slug: "herbal-teas-supplements", name: "Herbal teas & supplements", description: "Herbal teas and supplements.", sortOrder: 5 },
  { slug: "seeds-resins-crystals", name: "Seeds, resins & crystals", description: "Loose natural materials.", sortOrder: 6 },
  { slug: "bundles", name: "Bundles", description: "Products sold together as a set.", sortOrder: 7 },
];

const CHECK = "Confirm the name, size, price, cost and supplier before publishing.";

export const PRODUCTS: SeedProduct[] = [
  {
    key: "mvuto-oil-hadid",
    name: "Mvuto Oil",
    brand: "Hadid Herbs Maridhawa",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "100 ml",
    labelTranscript:
      "Front: HADID HERBS Maridhawa — Mvuto OIL — 'Mapenzi' / 'Biashara'. Side panel shows '100mls' and a QR code; packed by Hadid Herbs & Remedies (Zanzibar). Back panel (Swahili and English) lists seven uses including business attraction, removing 'nuksi', 'cleaning the stars', protection from witchcraft, and attraction in love and business. Directions on box: apply twice daily for 7–21 days.",
    reviewNotes: `Size '100mls' read from the side panel in one photo — confirm. The box text makes business, love and supernatural claims; these are kept out of the public description. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0013.jpg", crop: [0.33, 0.27, 0.27, 0.71], alt: "Mvuto Oil box by Hadid Herbs Maridhawa" },
      { file: "IMG-20260924-WA0015.jpg", alt: "Mvuto Oil box, front and back panel" },
      { file: "IMG-20260924-WA0036.jpg", crop: [0.0, 0.26, 0.36, 0.72], alt: "Mvuto Oil box" },
      { file: "IMG-20260924-WA0025.jpg", alt: "Mvuto Oil boxes with Mvuto soap and cleansing powder" },
    ],
  },
  {
    key: "mvuto-soap-muni",
    name: "Mvuto Soap (Sabuni ya Kuondoa Nuksi na Mikosi)",
    brand: "Muni Natural Beauty",
    category: "soaps",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Bar",
    labelTranscript: "Front: 'muni' Natural Beauty — Mvuto — 'Sabuni ya kuondoa nuksi na mikosi' — 'Original'. Weight not visible in the photos.",
    reviewNotes: `Bar weight not visible. The subtitle on the box translates roughly as 'soap to remove bad luck and misfortune'; decide whether to show it. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0025.jpg", crop: [0.19, 0.23, 0.62, 0.2], alt: "Two boxes of Muni Mvuto soap" },
      { file: "IMG-20260924-WA0055.jpg", crop: [0.27, 0.14, 0.46, 0.24], alt: "Muni Mvuto soap box" },
    ],
  },
  {
    key: "mvuto-bukhoor-hadid",
    name: "Mvuto Bukhoor",
    brand: "Hadid",
    category: "powders-bukhoor",
    productType: "INCENSE_FRAGRANCE",
    variantName: "Jar",
    labelTranscript: "Jar label: 'HADID BUKHOOR Mvuto' with 'Mapenzi' / 'Biashara' on a rose background. Contents look like ground bukhoor. Weight not visible.",
    reviewNotes: `Seen only inside the 'Attraction pack' photo. Confirm it is sold separately, and its weight. ${CHECK}`,
    images: [{ file: "IMG-20260924-WA0018.jpg", crop: [0.41, 0.16, 0.27, 0.56], alt: "Hadid Bukhoor Mvuto jar" }],
  },
  {
    key: "attraction-pack",
    name: "Attraction Pack",
    brand: null,
    category: "bundles",
    productType: "BUNDLE",
    variantName: "Set of 3",
    priceKES: 2000,
    labelTranscript: "Owner's photo overlay reads 'Attraction pack 2000'. Shows Hadid Maridhawa Mvuto Oil, Hadid Bukhoor Mvuto and Muni Mvuto soap.",
    reviewNotes: "Price KES 2,000 taken from the text on the owner's photo — confirm. Contents assumed to be one of each item shown; confirm quantities.",
    images: [{ file: "IMG-20260924-WA0018.jpg", alt: "Attraction pack: Mvuto Oil, Mvuto Bukhoor and Mvuto soap" }],
    bundleOf: [
      { key: "mvuto-oil-hadid", qty: 1 },
      { key: "mvuto-bukhoor-hadid", qty: 1 },
      { key: "mvuto-soap-muni", qty: 1 },
    ],
  },
  {
    key: "habat-nuksi-soap",
    name: "Habat Nuksi Soap",
    brand: "Fimbo ya Mussa Products",
    category: "soaps",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "100 g",
    trackBatches: true,
    labelTranscript:
      "Front: 'FIMBO YA MUSSA PRODUCTS — HABAT NUKSI Soap — ORIGINAL No. 1'. Box side shows '100gms', a QR code, a maker's name and two phone numbers, and printed manufacture/expiry dates (not fully legible).",
    reviewNotes: `Weight '100gms' read from the box side — confirm. Expiry date printed on box: record batches when receiving stock. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0014.jpg", alt: "Habat Nuksi soap and oil boxes" },
      { file: "IMG-20260924-WA0049.jpg", crop: [0.19, 0.19, 0.6, 0.29], alt: "Stack of Habat Nuksi soap boxes" },
    ],
  },
  {
    key: "habat-nuksi-oil",
    name: "Mafuta ya Habat Nuksi (Habat Nuksi Oil)",
    brand: "Fimbo ya Mussa Herbs Products",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Bottle",
    labelTranscript: "Front: 'MAFUTA YA HABAT NUKSI — HABAT NUKSI OIL — ORIGINAL No. 1' with the Fimbo ya Mussa crest. Volume not visible.",
    reviewNotes: `Volume not visible in the photos. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0049.jpg", crop: [0.14, 0.4, 0.56, 0.22], alt: "Habat Nuksi Oil boxes" },
      { file: "IMG-20260924-WA0014.jpg", alt: "Habat Nuksi Oil boxes with Habat Nuksi soap" },
    ],
  },
  {
    key: "mafuta-ya-bahati",
    name: "Mafuta ya Bahati ya Ngekewa Ngekewa Oil",
    brand: "Fimbo ya Mussa Herbs Products",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Bottle",
    labelTranscript: "Front: 'MAFUTA YA BAHATI' / 'YA NGEKEWA NGEKEWA OIL' / 'Original No.1' with the Fimbo ya Mussa Herbs Products crest.",
    reviewNotes: `The label reads 'Ngekewa' (the brief said 'Ngekewe'); the name follows the label. Volume not visible. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0013.jpg", crop: [0.58, 0.26, 0.37, 0.72], alt: "Mafuta ya Bahati ya Ngekewa Ngekewa Oil box" },
      { file: "IMG-20260924-WA0036.jpg", crop: [0.61, 0.27, 0.36, 0.7], alt: "Mafuta ya Bahati box" },
    ],
  },
  {
    key: "b2-money-oil",
    name: "B2 Fast Cash Money Oil",
    brand: "B2",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Bottle",
    labelTranscript: "Front: 'B2' shield — 'FAST CASH MONEY OIL'. Maker and volume not visible.",
    reviewNotes: `The product name itself promises money; the claims check will ask the owner to approve it before publishing. Volume and maker not visible. ${CHECK}`,
    images: [{ file: "IMG-20260924-WA0013.jpg", crop: [0.05, 0.36, 0.3, 0.62], alt: "B2 Fast Cash Money Oil box" }],
  },
  {
    key: "hassad-guard",
    name: "Hassad Guard Incense Oil",
    brand: null,
    category: "incense",
    productType: "INCENSE_FRAGRANCE",
    variantName: "Bottle",
    labelTranscript: "Front: 'HASSAD GUARD — INCENSE OIL' with an eye illustration; icons labelled 'KINGA', 'ULINZI', 'UTULIVU'. Maker and volume not visible.",
    reviewNotes: `Maker and volume not visible. ${CHECK}`,
    images: [{ file: "IMG-20260924-WA0036.jpg", crop: [0.33, 0.33, 0.31, 0.63], alt: "Hassad Guard Incense Oil box" }],
  },
  {
    key: "energy-cleansing-powder",
    name: "Energy Cleansing Powder",
    brand: null,
    category: "powders-bukhoor",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Jar",
    trackBatches: true,
    labelTranscript:
      "Jar label (partly hidden): '…RGY CLEANSING POWDER', '100% Pure', 'Batch No. MC011', 'MFG: 1-MAY-2025', 'EXP: 1-MAY-2027', 'Keep out of reach of children', 'Store in a cool dry place', and a numbered list of benefits in Swahili.",
    reviewNotes: `First word of the name is hidden in both photos; 'Energy' is a best reading of '…RGY'. Confirm. Batch MC011 (exp 1 May 2027) seen on jars: enter it when recording opening stock. Ingredients not listed. ${CHECK}`,
    warnings: "Keep out of reach of children. Store in a cool, dry place.",
    images: [
      { file: "IMG-20260924-WA0049.jpg", crop: [0.1, 0.53, 0.66, 0.39], alt: "Two jars of cleansing powder" },
      { file: "IMG-20260924-WA0025.jpg", crop: [0.17, 0.49, 0.56, 0.36], alt: "Two jars of cleansing powder" },
    ],
  },
  {
    key: "mvuto-powder",
    name: "Mvuto Powder (Business Boost)",
    brand: null,
    category: "powders-bukhoor",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Pouch",
    labelTranscript:
      "Only a promotional graphic was supplied ('Uses of Mvuto Powder (Massive Sale Business Powder)'), showing a gold pouch labelled 'Business Boost — MVUTO POWDER — Natural & Traditional — Massive Sale'. The pouch artwork contains a misspelling, which suggests it may be a mock-up rather than a photo of the stocked product.",
    reviewNotes:
      "Not confirmed: no photo of the actual product was supplied, so no image is attached (the graphic is in the image library). The graphic promises sales and prosperity and mentions spells; none of that is used. Photograph the real pouch before publishing.",
    images: [],
  },
  {
    key: "slimfast-tea",
    name: "Slimfast Herbal Tea",
    brand: null,
    category: "herbal-teas-supplements",
    productType: "HERBAL_CONSUMABLE",
    variantName: "Jar",
    labelTranscript: "Jar label: 'Slimfast — Herbal Tea — LOOSE WEIGHT & KEEP IT OFF — LIVE NATURAL'; a partly hidden red badge appears to mention a money-back guarantee. Maker, weight and ingredients not visible.",
    reviewNotes:
      "Consumable with a weight-loss claim on the label: check whether it needs Pharmacy and Poisons Board / KEBS approval before selling online, and get the ingredient list from the supplier. The name closely resembles the international 'SlimFast' brand; confirm the supplier's right to use it. Maker, weight and ingredients not visible.",
    images: [{ file: "IMG-20260924-WA0038.jpg", alt: "Jar of Slimfast Herbal Tea" }],
  },
  {
    key: "jini-mahaba",
    name: "Mafuta ya Jini Mahaba",
    brand: "Ludimo Herbs",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "100 ml",
    labelTranscript: "Front: 'Ludimo Herbs' — Arabic text — 'MAFUTA YA JINI MAHABA — Original No. 1' — '100mls' — 'New'.",
    reviewNotes: `Box artwork includes a nude winged figure; consider a cleaner product photo for the storefront. ${CHECK}`,
    images: [{ file: "IMG-20260924-WA0047.jpg", alt: "Mafuta ya Jini Mahaba box by Ludimo Herbs" }],
  },
  {
    key: "sai-flora",
    name: "Sri Sai Flora Fluxo Incense",
    brand: "Sri Sai Flora",
    category: "incense",
    productType: "INCENSE_FRAGRANCE",
    variantName: "Box",
    priceKES: 400,
    labelTranscript: "Box: 'Sri Sai Flora — FLUXO INCENSE'. Manufactured by Damodhar & Co., Bangalore; marketed by Tejas Incense Pvt. Ltd., Bangalore, India. Owner's photo overlay reads '400 per box'. Stick count/weight not visible.",
    reviewNotes: "Price KES 400 per box taken from the owner's photo overlay — confirm. Stick count or weight per box not visible.",
    images: [{ file: "IMG-20260924-WA0029.jpg", alt: "Six boxes of Sri Sai Flora Fluxo incense" }],
  },
  {
    key: "mtulize-limbwata",
    name: "Mtulize kwa Limbwata",
    brand: null,
    category: "powders-bukhoor",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Jar",
    labelTranscript: "Jar label: 'Mtulize Kwa LIMBWATA' with a palm-tree heart illustration; maker name partly visible ('MALKIA …'). Contents and weight not visible.",
    reviewNotes: `Maker name only partly visible; contents (powder or paste) and weight unknown. The name refers to a love charm; the claims check will ask for owner approval. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0034.jpg", alt: "Mtulize kwa Limbwata jar" },
      { file: "IMG-20260924-WA0027.jpg", alt: "Mtulize kwa Limbwata jar, side view" },
    ],
  },
  {
    key: "garlic-pearls",
    name: "Garlic Pearls",
    brand: "Garlic Pearls®",
    category: "herbal-teas-supplements",
    productType: "HERBAL_CONSUMABLE",
    variantName: "100 pearls",
    labelTranscript: "Box: 'Garlic Pearls®' — 'Natural Way to Healthy Heart & Digestion' — '100 Garlic Pearls'.",
    reviewNotes:
      "Registered-brand supplement with a health claim on the box. Use the manufacturer's approved wording and check registration before selling online; the box claim is not used in the description.",
    images: [{ file: "IMG-20260924-WA0051.jpg", alt: "Box of Garlic Pearls, 100 pearls" }],
  },
  {
    key: "nyota-soap",
    name: "Sabuni ya Nyota (Nyota Soap)",
    brand: null,
    category: "soaps",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Bar",
    labelTranscript: "Box: 'SABUNI YA NYOTA — nyota Soap' with a portrait photo and leopard-print band.",
    reviewNotes: `Maker and weight not visible. ${CHECK}`,
    images: [{ file: "IMG-20260924-WA0052.jpg", crop: [0.13, 0.15, 0.51, 0.25], alt: "Sabuni ya Nyota soap box" }],
  },
  {
    key: "nyota-oil",
    name: "Mafuta ya Nyota (Nyota Oil)",
    brand: "Fimbo ya Mussa Herbs Products",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "100 ml",
    labelTranscript: "Box: Fimbo ya Mussa Herbs Products crest — 'MAFUTA YA NYOTA — NYOTA OIL' — 'Produk Original 100%' seal — '100 ml'.",
    reviewNotes: CHECK,
    images: [{ file: "IMG-20260924-WA0052.jpg", crop: [0.46, 0.38, 0.33, 0.56], alt: "Mafuta ya Nyota, Nyota Oil 100 ml box" }],
  },
  {
    key: "nyota-powder",
    name: "Nyota Powder",
    brand: null,
    category: "powders-bukhoor",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Jar",
    labelTranscript: "Clear jar with a handwritten 'Nyota powder' label.",
    reviewNotes: "Hand-labelled, so it appears to be packed in-house: record what it contains and its weight, and consider a printed label. " + CHECK,
    images: [{ file: "IMG-20260924-WA0052.jpg", crop: [0.06, 0.37, 0.44, 0.48], alt: "Jar of Nyota powder" }],
  },
  {
    key: "mvuto-no-01",
    name: "Mvuto No. 01",
    brand: null,
    category: "powders-bukhoor",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "Jar",
    labelTranscript: "Round jar, yellow lid: 'MVUTO NO…' — 'Huu ni mvuto uliyochanganywa dawa zote zinazoleta…' — list of uses (partly legible) — 'MVUTO NO. 01'.",
    reviewNotes: `Contents (powder?) and weight unknown; label lists uses that are partly legible. ${CHECK}`,
    images: [
      { file: "IMG-20260924-WA0055.jpg", crop: [0.08, 0.35, 0.41, 0.52], alt: "Mvuto No. 01 jar" },
    ],
  },
  {
    key: "mahabat-mawadah",
    name: "Mahabat Mawadah Mvuto Oil",
    brand: "Hadid Herbs Remedies",
    category: "oils",
    productType: "TRADITIONAL_SPIRITUAL",
    variantName: "100 ml",
    labelTranscript: "Box: 'HADID HERBS REMEDIES — MAHABAT MAWADAH — Mvuto Oil — 100ml', with an incense burner illustration.",
    reviewNotes: CHECK,
    images: [{ file: "IMG-20260924-WA0055.jpg", crop: [0.5, 0.32, 0.27, 0.6], alt: "Mahabat Mawadah Mvuto Oil box" }],
  },
  {
    key: "babaplus",
    name: "BabaPlus Homens",
    brand: "BabaPlus",
    category: "herbal-teas-supplements",
    productType: "HERBAL_CONSUMABLE",
    variantName: "Jar",
    trackBatches: true,
    labelTranscript: "Jar label: 'BabaPlus — Herbal Medicine for Men, Sexual Power & appetite — Homens — Renew Sexual Power'; expiry 'DEC 2029'; Portuguese text on the side.",
    reviewNotes:
      "Sold as a medicine for sexual performance. Herbal medicines generally need Pharmacy and Poisons Board registration to be sold and advertised in Kenya: confirm registration before listing it online. Its label claims are not used. Contents, dose and maker not visible.",
    shippingRestriction: "Confirm regulatory status before shipping.",
    images: [{ file: "IMG-20260924-WA0058.jpg", alt: "Jar of BabaPlus Homens" }],
  },
  {
    key: "unlabelled-powder",
    name: "Unidentified powder (handwritten label)",
    brand: null,
    category: "powders-bukhoor",
    productType: "OTHER",
    variantName: "Packet",
    labelTranscript: "Clear sealed packet of light brown powder with a handwritten marker label that is hard to read (possibly 'ITALIGO LA…').",
    reviewNotes: "Couldn't read the handwritten name reliably. Enter the correct name, contents and weight.",
    images: [{ file: "IMG-20260924-WA0006.jpg", alt: "Packet of light brown powder with a handwritten label" }],
  },
  {
    key: "white-crystals",
    name: "Unidentified white crystals (gold pouch)",
    brand: null,
    category: "seeds-resins-crystals",
    productType: "OTHER",
    variantName: "Pouch",
    labelTranscript: "Gold stand-up zip pouch with a clear window, filled with white/clear crystal chunks. No label.",
    reviewNotes: "No label visible. Name the product (e.g. resin or mineral) and record its weight before publishing.",
    images: [{ file: "IMG-20260924-WA0021.jpg", alt: "Gold pouch of white crystals" }],
  },
  {
    key: "red-black-seeds",
    name: "Unidentified red-and-black seeds",
    brand: null,
    category: "seeds-resins-crystals",
    productType: "OTHER",
    variantName: "Loose",
    labelTranscript: "Tall clear container of glossy red seeds with a black patch.",
    reviewNotes:
      "Seeds that look like this are often rosary pea (Abrus precatorius), which is highly poisonous if chewed or swallowed. Confirm what they are; if they are rosary pea, add a clear poison warning, keep them away from children and decide whether to sell them at all.",
    warnings: "Not for eating. Keep away from children and pets.",
    images: [{ file: "IMG-20260924-WA0030.jpg", alt: "Container of red seeds with black spots" }],
  },
];

/** Photos with no product of their own, kept in the image library. */
export const LIBRARY_ONLY = [
  { file: "IMG-20260924-WA0016.jpg", note: "Promotional graphic for Mvuto Powder (contains outcome claims; not used on the storefront)." },
];
