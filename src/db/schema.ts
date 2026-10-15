/**
 * Database schema (PostgreSQL, Drizzle ORM).
 *
 * Conventions
 * - Money is integer cents of KES (100 = KES 1.00). Never floats.
 * - Financial history (payments, refunds, stock movements, documents, audit log) is append-only.
 *   Corrections are new rows (reversals/adjustments), never edits of past rows.
 * - `isDemo` marks sample records so they can be purged before going live (npm run db:purge-demo).
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => integer(name);

// ───────────────────────────── Enums ─────────────────────────────

export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const productStatus = pgEnum("product_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const productType = pgEnum("product_type", [
  "COSMETIC",
  "HOUSEHOLD",
  "TRADITIONAL_SPIRITUAL",
  "INCENSE_FRAGRANCE",
  "HERBAL_CONSUMABLE",
  "BUNDLE",
  "OTHER",
]);
export const taxCategory = pgEnum("tax_category", ["STANDARD", "ZERO_RATED", "EXEMPT"]);
export const locationType = pgEnum("location_type", ["STORE", "WAREHOUSE"]);
export const stockMovementType = pgEnum("stock_movement_type", [
  "INITIAL",
  "PURCHASE_RECEIVED",
  "SALE",
  "CUSTOMER_RETURN",
  "SUPPLIER_RETURN",
  "DAMAGE",
  "EXPIRY",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "RESERVATION",
  "RESERVATION_RELEASE",
  "QUARANTINE_IN",
  "QUARANTINE_WRITE_OFF",
]);
export const poStatus = pgEnum("po_status", ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]);
export const supplierInvoiceStatus = pgEnum("supplier_invoice_status", ["UNPAID", "PARTIALLY_PAID", "PAID", "VOID"]);
export const orderSource = pgEnum("order_source", ["ONLINE", "POS", "MANUAL"]);
export const orderStatus = pgEnum("order_status", [
  "PENDING",
  "AWAITING_PAYMENT",
  "PAID",
  "PROCESSING",
  "READY_FOR_COLLECTION",
  "DISPATCHED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const paymentStatus = pgEnum("payment_status", [
  "UNPAID",
  "PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "FAILED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const fulfilmentMethod = pgEnum("fulfilment_method", ["COLLECTION", "LOCAL_DELIVERY", "COURIER", "WALK_IN"]);
/** NONE nothing held · RESERVED held while unpaid · COMMITTED deducted (sold) · RELEASED reservation returned */
export const orderStockState = pgEnum("order_stock_state", ["NONE", "RESERVED", "COMMITTED", "RELEASED"]);
export const paymentMethod = pgEnum("payment_method", [
  "MPESA",
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "CASH_ON_DELIVERY",
  "OTHER",
]);
export const paymentAttemptStatus = pgEnum("payment_attempt_status", [
  "INITIATED",
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
export const paymentRecordStatus = pgEnum("payment_record_status", ["SUCCEEDED", "REVERSED"]);
export const refundStatus = pgEnum("refund_status", ["COMPLETED", "PENDING_PAYOUT"]);
export const itemCondition = pgEnum("item_condition", ["RESELLABLE", "DAMAGED", "NOT_RETURNED"]);
export const documentType = pgEnum("document_type", ["RECEIPT", "INVOICE", "CREDIT_NOTE"]);
export const promotionType = pgEnum("promotion_type", ["PERCENT", "FIXED", "FREE_DELIVERY"]);
export const promotionScope = pgEnum("promotion_scope", ["ORDER", "PRODUCTS", "CATEGORIES"]);
export const posSessionStatus = pgEnum("pos_session_status", ["OPEN", "CLOSED"]);
export const cashMovementType = pgEnum("cash_movement_type", [
  "OPENING_FLOAT",
  "SALE",
  "REFUND",
  "PAY_IN",
  "PAY_OUT",
  "CASH_DROP",
]);
export const expenseStatus = pgEnum("expense_status", ["SUBMITTED", "APPROVED", "REJECTED"]);
export const reviewType = pgEnum("review_type", ["PRODUCT", "EXPERIENCE", "DELIVERY", "SUPPORT"]);
export const reviewStatus = pgEnum("review_status", ["PENDING", "APPROVED", "REJECTED", "FLAGGED"]);
export const questionStatus = pgEnum("question_status", ["PENDING", "PUBLISHED", "HIDDEN"]);
export const ticketCategory = pgEnum("ticket_category", [
  "QUESTION",
  "COMPLAINT",
  "RETURN_REQUEST",
  "CANCELLATION_REQUEST",
  "DELIVERY_ISSUE",
  "OTHER",
]);
export const ticketStatus = pgEnum("ticket_status", ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const deliveryStatus = pgEnum("delivery_status", [
  "PENDING",
  "ASSIGNED",
  "DISPATCHED",
  "DELIVERED",
  "FAILED",
  "RETURNED",
]);
export const notificationChannel = pgEnum("notification_channel", ["EMAIL", "WHATSAPP", "SMS", "STAFF"]);
export const notificationStatus = pgEnum("notification_status", ["QUEUED", "SENT", "FAILED", "SKIPPED"]);
export const jobStatus = pgEnum("job_status", ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD"]);
export const dataRequestType = pgEnum("data_request_type", ["EXPORT", "DELETE"]);
export const dataRequestStatus = pgEnum("data_request_status", ["PENDING", "COMPLETED", "REJECTED"]);

// ───────────────────────────── Identity & access ─────────────────────────────

export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull().unique(), // OWNER, MANAGER, CASHIER, INVENTORY_CLERK, SUPPORT, CUSTOMER
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  isStaff: boolean("is_staff").notNull().default(true),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").unique(),
    phone: text("phone").unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: userStatus("status").notNull().default("ACTIVE"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEnc: text("mfa_secret_enc"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    passwordChangedAt: ts("password_changed_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("users_contact_present", sql`${t.email} is not null or ${t.phone} is not null`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mfaPending: boolean("mfa_pending").notNull().default(false),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_action_idx").on(t.action, t.createdAt),
    index("audit_created_idx").on(t.createdAt),
  ],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: uuid("updated_by_id"),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Customers ─────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: id(),
    userId: uuid("user_id")
      .unique()
      .references(() => users.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    isWholesale: boolean("is_wholesale").notNull().default(false),
    notes: text("notes"),
    marketingEmail: boolean("marketing_email").notNull().default(false),
    marketingSms: boolean("marketing_sms").notNull().default(false),
    marketingWhatsapp: boolean("marketing_whatsapp").notNull().default(false),
    consentUpdatedAt: ts("consent_updated_at"),
    anonymizedAt: ts("anonymized_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_phone_idx").on(t.phone), index("customers_email_idx").on(t.email)],
);

export const addresses = pgTable("addresses", {
  id: id(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  label: text("label"),
  recipient: text("recipient").notNull(),
  phone: text("phone").notNull(),
  county: text("county").notNull(),
  town: text("town").notNull(),
  area: text("area"),
  street: text("street"),
  landmark: text("landmark"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

export const dataRequests = pgTable("data_requests", {
  id: id(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  type: dataRequestType("type").notNull(),
  status: dataRequestStatus("status").notNull().default("PENDING"),
  note: text("note"),
  handledById: uuid("handled_by_id"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});

// ───────────────────────────── Catalog ─────────────────────────────

export const categories = pgTable("categories", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  parentId: uuid("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    brand: text("brand"),
    categoryId: uuid("category_id").references(() => categories.id),
    productType: productType("product_type").notNull().default("OTHER"),
    status: productStatus("status").notNull().default("DRAFT"),
    publishAt: ts("publish_at"),
    isFeatured: boolean("is_featured").notNull().default(false),
    description: text("description"),
    usageInstructions: text("usage_instructions"),
    warnings: text("warnings"),
    ingredients: text("ingredients"),
    ingredientsVerified: boolean("ingredients_verified").notNull().default(false),
    /** Seeded entries start incomplete; staff clear this once name, category, price and wording are verified. */
    needsReview: boolean("needs_review").notNull().default(true),
    reviewNotes: text("review_notes"),
    /** Staff-only transcription of what the physical label says. Never shown on the storefront. */
    labelTranscript: text("label_transcript"),
    /** Owner sign-off required to publish wording flagged by the claims guard. */
    claimsApproved: boolean("claims_approved").notNull().default(false),
    claimsApprovalNote: text("claims_approval_note"),
    shippingRestriction: text("shipping_restriction"),
    taxCategory: taxCategory("tax_category").notNull().default("STANDARD"),
    defaultSupplierId: uuid("default_supplier_id").references(() => suppliers.id),
    archivedAt: ts("archived_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_status_cat_idx").on(t.status, t.categoryId)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull().default("Standard"),
    sku: text("sku").unique(),
    barcode: text("barcode").unique(),
    /** null = price not set yet; the variant cannot be sold until it is. */
    priceCents: money("price_cents"),
    compareAtCents: money("compare_at_cents"),
    wholesalePriceCents: money("wholesale_price_cents"),
    wholesaleMinQty: integer("wholesale_min_qty").notNull().default(1),
    /** Weighted average cost, maintained when goods are received. */
    avgCostCents: money("avg_cost_cents"),
    reorderLevel: integer("reorder_level").notNull().default(0),
    reorderQty: integer("reorder_qty").notNull().default(0),
    weightGrams: integer("weight_grams"),
    trackBatches: boolean("track_batches").notNull().default(false),
    isBundle: boolean("is_bundle").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    check("variant_price_nonneg", sql`${t.priceCents} is null or ${t.priceCents} >= 0`),
  ],
);

export const bundleItems = pgTable(
  "bundle_items",
  {
    id: id(),
    bundleVariantId: uuid("bundle_variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    componentVariantId: uuid("component_variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
  },
  (t) => [uniqueIndex("bundle_items_uq").on(t.bundleVariantId, t.componentVariantId), check("bundle_qty_pos", sql`${t.qty} > 0`)],
);

export const mediaAssets = pgTable("media_assets", {
  id: id(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name"),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  caption: text("caption"),
  sourceNote: text("source_note"),
  createdAt: createdAt(),
});

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Non-destructive crop as fractions (0..1) of the original. */
    cropX: real("crop_x"),
    cropY: real("crop_y"),
    cropW: real("crop_w"),
    cropH: real("crop_h"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("product_images_uq").on(t.productId, t.assetId)],
);

// ───────────────────────────── Inventory ─────────────────────────────

export const locations = pgTable("locations", {
  id: id(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  type: locationType("type").notNull().default("STORE"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** onHand = present and sellable · reserved = held for unpaid orders · available = onHand - reserved. */
export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    quarantined: integer("quarantined").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("inv_bal_uq").on(t.variantId, t.locationId),
    check("inv_onhand_nonneg", sql`${t.onHand} >= 0`),
    check("inv_reserved_range", sql`${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`),
    check("inv_quarantine_nonneg", sql`${t.quarantined} >= 0`),
  ],
);

export const stockBatches = pgTable(
  "stock_batches",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    batchNo: text("batch_no").notNull(),
    expiresAt: ts("expires_at"),
    qtyOnHand: integer("qty_on_hand").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("batch_uq").on(t.variantId, t.locationId, t.batchNo), check("batch_qty_nonneg", sql`${t.qtyOnHand} >= 0`)],
);

/** Immutable ledger: each row records exactly how a balance changed and why. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    type: stockMovementType("type").notNull(),
    onHandDelta: integer("on_hand_delta").notNull().default(0),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    quarantineDelta: integer("quarantine_delta").notNull().default(0),
    onHandAfter: integer("on_hand_after").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"), // ORDER, GOODS_RECEIPT, REFUND, TRANSFER, MANUAL
    refId: text("ref_id"),
    unitCostCents: money("unit_cost_cents"),
    batchNo: text("batch_no"),
    userId: uuid("user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("mov_variant_idx").on(t.variantId, t.createdAt),
    index("mov_ref_idx").on(t.refType, t.refId),
    index("mov_type_idx").on(t.type, t.createdAt),
  ],
);

// ───────────────────────────── Purchasing ─────────────────────────────

export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  number: text("number").notNull().unique(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  status: poStatus("status").notNull().default("DRAFT"),
  orderedAt: ts("ordered_at"),
  expectedAt: ts("expected_at"),
  notes: text("notes"),
  createdById: uuid("created_by_id"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qtyOrdered: integer("qty_ordered").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
    unitCostCents: money("unit_cost_cents").notNull(),
  },
  (t) => [
    check("poi_qty_pos", sql`${t.qtyOrdered} > 0`),
    check("poi_received_range", sql`${t.qtyReceived} >= 0 and ${t.qtyReceived} <= ${t.qtyOrdered}`),
  ],
);

export const goodsReceipts = pgTable("goods_receipts", {
  id: id(),
  number: text("number").notNull().unique(),
  /** Prevents a double-submitted form from adding stock twice. */
  idempotencyKey: text("idempotency_key").notNull().unique(),
  poId: uuid("po_id").references(() => purchaseOrders.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  supplierInvoiceRef: text("supplier_invoice_ref"),
  notes: text("notes"),
  receivedById: uuid("received_by_id"),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

export const goodsReceiptItems = pgTable("goods_receipt_items", {
  id: id(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => goodsReceipts.id, { onDelete: "cascade" }),
  poItemId: uuid("po_item_id").references(() => purchaseOrderItems.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  qty: integer("qty").notNull(),
  unitCostCents: money("unit_cost_cents").notNull(),
  batchNo: text("batch_no"),
  expiresAt: ts("expires_at"),
});

export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: id(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    invoiceRef: text("invoice_ref").notNull(),
    amountCents: money("amount_cents").notNull(),
    issuedAt: ts("issued_at").notNull(),
    dueAt: ts("due_at"),
    status: supplierInvoiceStatus("status").notNull().default("UNPAID"),
    notes: text("notes"),
    createdById: uuid("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("supplier_invoice_uq").on(t.supplierId, t.invoiceRef)],
);

export const supplierPayments = pgTable("supplier_payments", {
  id: id(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  invoiceId: uuid("invoice_id").references(() => supplierInvoices.id),
  amountCents: money("amount_cents").notNull(),
  method: paymentMethod("method").notNull(),
  reference: text("reference"),
  paidAt: ts("paid_at").notNull(),
  createdById: uuid("created_by_id"),
  createdAt: createdAt(),
});

// ───────────────────────────── Delivery ─────────────────────────────

export const deliveryZones = pgTable("delivery_zones", {
  id: id(),
  name: text("name").notNull(),
  method: fulfilmentMethod("method").notNull(), // LOCAL_DELIVERY or COURIER
  description: text("description"),
  feeCents: money("fee_cents").notNull(),
  freeOverCents: money("free_over_cents"),
  /** Only shown to customers when the owner has set it. */
  etaText: text("eta_text"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
});

// ───────────────────────────── POS ─────────────────────────────

export const posSessions = pgTable(
  "pos_sessions",
  {
    id: id(),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => users.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    status: posSessionStatus("status").notNull().default("OPEN"),
    openingFloatCents: money("opening_float_cents").notNull(),
    expectedCashCents: money("expected_cash_cents"),
    countedCashCents: money("counted_cash_cents"),
    varianceCents: money("variance_cents"),
    closingNote: text("closing_note"),
    closedById: uuid("closed_by_id"),
    openedAt: ts("opened_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  // One open shift per cashier at a time.
  (t) => [uniqueIndex("pos_one_open_per_cashier").on(t.cashierId).where(sql`${t.status} = 'OPEN'`)],
);

// ───────────────────────────── Orders ─────────────────────────────

export const carts = pgTable(
  "carts",
  {
    id: id(),
    tokenHash: text("token_hash").unique(),
    customerId: uuid("customer_id").references(() => customers.id),
    couponCode: text("coupon_code"),
    reminderSentAt: ts("reminder_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("carts_customer_idx").on(t.customerId)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cart_items_uq").on(t.cartId, t.variantId), check("cart_qty_pos", sql`${t.qty} > 0`)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: text("number").notNull().unique(),
    idempotencyKey: text("idempotency_key").unique(),
    source: orderSource("source").notNull(),
    status: orderStatus("status").notNull().default("PENDING"),
    paymentStatus: paymentStatus("payment_status").notNull().default("UNPAID"),
    fulfilmentMethod: fulfilmentMethod("fulfilment_method").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    deliveryAddress: jsonb("delivery_address"),
    deliveryZoneId: uuid("delivery_zone_id").references(() => deliveryZones.id),
    notes: text("notes"),
    isWholesale: boolean("is_wholesale").notNull().default(false),
    currency: text("currency").notNull().default("KES"),
    taxInclusive: boolean("tax_inclusive").notNull().default(true),
    /** Sum of line totals (after line discounts), before order-level discount and delivery. */
    subtotalCents: money("subtotal_cents").notNull(),
    discountCents: money("discount_cents").notNull().default(0),
    deliveryFeeCents: money("delivery_fee_cents").notNull().default(0),
    /** Tax component. Included in total when taxInclusive, added on top otherwise. */
    taxCents: money("tax_cents").notNull().default(0),
    totalCents: money("total_cents").notNull(),
    amountPaidCents: money("amount_paid_cents").notNull().default(0),
    refundedCents: money("refunded_cents").notNull().default(0),
    couponCode: text("coupon_code"),
    paymentMethodChosen: paymentMethod("payment_method_chosen"),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    stockState: orderStockState("stock_state").notNull().default("NONE"),
    reservationExpiresAt: ts("reservation_expires_at"),
    posSessionId: uuid("pos_session_id").references(() => posSessions.id),
    cashierId: uuid("cashier_id"),
    assignedToId: uuid("assigned_to_id"),
    /** Hash of the secret in guest order links. */
    accessTokenHash: text("access_token_hash"),
    policyAcceptedAt: ts("policy_accepted_at"),
    placedAt: ts("placed_at").notNull().defaultNow(),
    paidAt: ts("paid_at"),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_status_idx").on(t.status, t.placedAt),
    index("orders_customer_idx").on(t.customerId),
    index("orders_placed_idx").on(t.placedAt),
    index("orders_source_idx").on(t.source, t.placedAt),
    check("orders_amounts_nonneg", sql`${t.totalCents} >= 0 and ${t.amountPaidCents} >= 0 and ${t.refundedCents} >= 0`),
    check("orders_refund_le_paid", sql`${t.refundedCents} <= ${t.amountPaidCents}`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    productName: text("product_name").notNull(),
    variantName: text("variant_name").notNull(),
    sku: text("sku"),
    qty: integer("qty").notNull(),
    /** Price actually charged per unit (after any authorised override). */
    unitPriceCents: money("unit_price_cents").notNull(),
    /** Catalog price at time of sale. */
    listPriceCents: money("list_price_cents").notNull(),
    discountCents: money("discount_cents").notNull().default(0),
    lineTotalCents: money("line_total_cents").notNull(),
    taxCents: money("tax_cents").notNull().default(0),
    /** Cost snapshot for gross profit; null when cost was unknown. */
    unitCostCents: money("unit_cost_cents"),
    qtyRefunded: integer("qty_refunded").notNull().default(0),
    priceOverriddenById: uuid("price_overridden_by_id"),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("oi_qty_pos", sql`${t.qty} > 0`),
    check("oi_refund_range", sql`${t.qtyRefunded} >= 0 and ${t.qtyRefunded} <= ${t.qty}`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    type: text("type").notNull(), // status_change, payment, note, notification, stock, refund
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status"),
    message: text("message").notNull(),
    userId: uuid("user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_idx").on(t.orderId, t.createdAt)],
);

// ───────────────────────────── Payments & refunds ─────────────────────────────

/** One request to a payment provider (e.g. an STK push). A payment row exists only after verified success. */
export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull(), // mpesa_daraja | mpesa_simulator
    phone: text("phone").notNull(),
    amountCents: money("amount_cents").notNull(),
    status: paymentAttemptStatus("status").notNull().default("INITIATED"),
    checkoutRequestId: text("checkout_request_id").unique(),
    merchantRequestId: text("merchant_request_id"),
    resultCode: text("result_code"),
    resultDesc: text("result_desc"),
    providerReceipt: text("provider_receipt"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
    lastQueriedAt: ts("last_queried_at"),
  },
  (t) => [index("attempts_status_idx").on(t.status, t.createdAt), index("attempts_order_idx").on(t.orderId)],
);

export const paymentCallbackLogs = pgTable(
  "payment_callback_logs",
  {
    id: id(),
    provider: text("provider").notNull(),
    checkoutRequestId: text("checkout_request_id"),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").notNull(),
    outcome: text("outcome"),
    ip: text("ip"),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("callback_checkout_idx").on(t.checkoutRequestId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    method: paymentMethod("method").notNull(),
    status: paymentRecordStatus("status").notNull().default("SUCCEEDED"),
    amountCents: money("amount_cents").notNull(),
    currency: text("currency").notNull().default("KES"),
    /** Provider receipt (e.g. M-Pesa code) or manual reference. Unique per method so a code is never counted twice. */
    reference: text("reference"),
    attemptId: uuid("attempt_id")
      .unique()
      .references(() => paymentAttempts.id),
    recordedById: uuid("recorded_by_id"),
    posSessionId: uuid("pos_session_id"),
    note: text("note"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    reversedAt: ts("reversed_at"),
    reversalReason: text("reversal_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_method_ref_uq").on(t.method, t.reference),
    index("payments_received_idx").on(t.receivedAt),
    index("payments_order_idx").on(t.orderId),
    check("payments_amount_pos", sql`${t.amountCents} > 0`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    number: text("number").notNull().unique(),
    idempotencyKey: text("idempotency_key").unique(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    amountCents: money("amount_cents").notNull(),
    reason: text("reason").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    status: refundStatus("status").notNull().default("COMPLETED"),
    createdById: uuid("created_by_id").notNull(),
    posSessionId: uuid("pos_session_id"),
    paidOutAt: ts("paid_out_at"),
    createdAt: createdAt(),
  },
  (t) => [check("refund_amount_pos", sql`${t.amountCents} > 0`), index("refunds_created_idx").on(t.createdAt)],
);

export const refundItems = pgTable("refund_items", {
  id: id(),
  refundId: uuid("refund_id")
    .notNull()
    .references(() => refunds.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id")
    .notNull()
    .references(() => orderItems.id),
  qty: integer("qty").notNull(),
  amountCents: money("amount_cents").notNull(),
  condition: itemCondition("condition").notNull(),
});

/** Frozen copy of a financial document. Reprints read the snapshot; they never create a new sale. */
export const documents = pgTable("documents", {
  id: id(),
  type: documentType("type").notNull(),
  number: text("number").notNull().unique(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  refundId: uuid("refund_id").references(() => refunds.id),
  isTaxInvoice: boolean("is_tax_invoice").notNull().default(false),
  snapshot: jsonb("snapshot").notNull(),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  printCount: integer("print_count").notNull().default(0),
  lastPrintedAt: ts("last_printed_at"),
});

export const documentSequences = pgTable("document_sequences", {
  key: text("key").primaryKey(), // RECEIPT, INVOICE, CREDIT_NOTE, ORDER, PO, GRN, TICKET
  prefix: text("prefix").notNull(),
  next: integer("next").notNull().default(1),
});

// ───────────────────────────── Promotions & marketing ─────────────────────────────

export const promotions = pgTable("promotions", {
  id: id(),
  name: text("name").notNull(),
  /** null = applied automatically when rules match. */
  code: text("code").unique(),
  type: promotionType("type").notNull(),
  /** Percent (0-100) for PERCENT, cents for FIXED, ignored for FREE_DELIVERY. */
  value: integer("value").notNull().default(0),
  scope: promotionScope("scope").notNull().default("ORDER"),
  productIds: uuid("product_ids").array().notNull().default(sql`'{}'::uuid[]`),
  categoryIds: uuid("category_ids").array().notNull().default(sql`'{}'::uuid[]`),
  minOrderCents: money("min_order_cents"),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").notNull().default(0),
  perCustomerLimit: integer("per_customer_limit"),
  customerId: uuid("customer_id").references(() => customers.id),
  stackable: boolean("stackable").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const promotionRedemptions = pgTable(
  "promotion_redemptions",
  {
    id: id(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    customerId: uuid("customer_id"),
    amountCents: money("amount_cents").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("redemption_uq").on(t.promotionId, t.orderId)],
);

export const banners = pgTable("banners", {
  id: id(),
  title: text("title").notNull(),
  body: text("body"),
  linkUrl: text("link_url"),
  linkLabel: text("link_label"),
  placement: text("placement").notNull().default("home"),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: id(),
  email: text("email").notNull().unique(),
  consentText: text("consent_text").notNull(),
  consentAt: ts("consent_at").notNull().defaultNow(),
  source: text("source"),
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  unsubscribedAt: ts("unsubscribed_at"),
});

// ───────────────────────────── Cash ─────────────────────────────

export const cashMovements = pgTable("cash_movements", {
  id: id(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => posSessions.id),
  type: cashMovementType("type").notNull(),
  /** Signed: positive into the drawer, negative out. */
  amountCents: money("amount_cents").notNull(),
  reason: text("reason"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  userId: uuid("user_id").notNull(),
  createdAt: createdAt(),
});

export const suspendedSales = pgTable("suspended_sales", {
  id: id(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => posSessions.id),
  label: text("label").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
  resumedAt: ts("resumed_at"),
});

// ───────────────────────────── Expenses ─────────────────────────────

export const expenseCategories = pgTable("expense_categories", {
  id: id(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
});

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    date: ts("date").notNull(),
    amountCents: money("amount_cents").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    payee: text("payee"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    paymentMethod: paymentMethod("payment_method").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    attachmentKey: text("attachment_key"),
    status: expenseStatus("status").notNull().default("SUBMITTED"),
    createdById: uuid("created_by_id").notNull(),
    approvedById: uuid("approved_by_id"),
    approvedAt: ts("approved_at"),
    rejectionNote: text("rejection_note"),
    posSessionId: uuid("pos_session_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_date_idx").on(t.date), check("expense_amount_pos", sql`${t.amountCents} > 0`)],
);

// ───────────────────────────── Feedback & support ─────────────────────────────

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    type: reviewType("type").notNull(),
    productId: uuid("product_id").references(() => products.id),
    orderId: uuid("order_id").references(() => orders.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body"),
    displayName: text("display_name").notNull(),
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    status: reviewStatus("status").notNull().default("PENDING"),
    adminResponse: text("admin_response"),
    respondedById: uuid("responded_by_id"),
    respondedAt: ts("responded_at"),
    moderatedById: uuid("moderated_by_id"),
    moderatedAt: ts("moderated_at"),
    moderationNote: text("moderation_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reviews_product_idx").on(t.productId, t.status),
    check("review_rating_range", sql`${t.rating} between 1 and 5`),
    // One product review per customer per product; one experience/delivery review per order.
    uniqueIndex("reviews_one_per_product").on(t.customerId, t.productId).where(sql`${t.type} = 'PRODUCT'`),
    uniqueIndex("reviews_one_per_order_type").on(t.customerId, t.orderId, t.type).where(sql`${t.type} <> 'PRODUCT'`),
  ],
);

export const reviewReports = pgTable("review_reports", {
  id: id(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  reporterHash: text("reporter_hash"),
  createdAt: createdAt(),
});

export const productQuestions = pgTable("product_questions", {
  id: id(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  customerId: uuid("customer_id").references(() => customers.id),
  askerName: text("asker_name").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  answeredById: uuid("answered_by_id"),
  answeredAt: ts("answered_at"),
  status: questionStatus("status").notNull().default("PENDING"),
  createdAt: createdAt(),
});

export const supportTickets = pgTable("support_tickets", {
  id: id(),
  number: text("number").notNull().unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  orderId: uuid("order_id").references(() => orders.id),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  subject: text("subject").notNull(),
  category: ticketCategory("category").notNull(),
  status: ticketStatus("status").notNull().default("OPEN"),
  priority: integer("priority").notNull().default(2),
  assignedToId: uuid("assigned_to_id"),
  resolution: text("resolution"),
  satisfaction: integer("satisfaction"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  resolvedAt: ts("resolved_at"),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => supportTickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id"),
  fromCustomer: boolean("from_customer").notNull().default(false),
  internal: boolean("internal").notNull().default(false),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const deliveries = pgTable("deliveries", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  zoneId: uuid("zone_id").references(() => deliveryZones.id),
  status: deliveryStatus("status").notNull().default("PENDING"),
  riderName: text("rider_name"),
  riderPhone: text("rider_phone"),
  courierName: text("courier_name"),
  trackingRef: text("tracking_ref"),
  assignedAt: ts("assigned_at"),
  dispatchedAt: ts("dispatched_at"),
  deliveredAt: ts("delivered_at"),
  receivedBy: text("received_by"),
  failedReason: text("failed_reason"),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Notifications & jobs ─────────────────────────────

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: id(),
    key: text("key").notNull(),
    channel: notificationChannel("channel").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("templates_uq").on(t.key, t.channel)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    /** event + channel + entity: guarantees a notification is created at most once. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    channel: notificationChannel("channel").notNull(),
    templateKey: text("template_key").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: notificationStatus("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    skipReason: text("skip_reason"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: ts("read_at"),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notif_status_idx").on(t.status, t.createdAt), index("notif_channel_idx").on(t.channel, t.readAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").unique(),
    status: jobStatus("status").notNull().default("QUEUED"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAt)],
);

// ───────────────────────────── Relations (for typed relational queries) ─────────────────────────────

export const rolesRelations = relations(roles, ({ many }) => ({ users: many(users) }));
export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  sessions: many(sessions),
  customer: one(customers, { fields: [users.id], references: [customers.userId] }),
}));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
export const customersRelations = relations(customers, ({ one, many }) => ({
  user: one(users, { fields: [customers.userId], references: [users.id] }),
  addresses: many(addresses),
  orders: many(orders),
  reviews: many(reviews),
}));
export const addressesRelations = relations(addresses, ({ one }) => ({
  customer: one(customers, { fields: [addresses.customerId], references: [customers.id] }),
}));
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: "tree" }),
  children: many(categories, { relationName: "tree" }),
  products: many(products),
}));
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  defaultSupplier: one(suppliers, { fields: [products.defaultSupplierId], references: [suppliers.id] }),
  variants: many(productVariants),
  images: many(productImages),
  reviews: many(reviews),
  questions: many(productQuestions),
}));
export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  balances: many(inventoryBalances),
  components: many(bundleItems, { relationName: "bundle" }),
}));
export const bundleItemsRelations = relations(bundleItems, ({ one }) => ({
  bundle: one(productVariants, {
    fields: [bundleItems.bundleVariantId],
    references: [productVariants.id],
    relationName: "bundle",
  }),
  component: one(productVariants, { fields: [bundleItems.componentVariantId], references: [productVariants.id] }),
}));
export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
  asset: one(mediaAssets, { fields: [productImages.assetId], references: [mediaAssets.id] }),
}));
export const mediaAssetsRelations = relations(mediaAssets, ({ many }) => ({ productImages: many(productImages) }));
export const inventoryBalancesRelations = relations(inventoryBalances, ({ one }) => ({
  variant: one(productVariants, { fields: [inventoryBalances.variantId], references: [productVariants.id] }),
  location: one(locations, { fields: [inventoryBalances.locationId], references: [locations.id] }),
}));
export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  variant: one(productVariants, { fields: [stockMovements.variantId], references: [productVariants.id] }),
  location: one(locations, { fields: [stockMovements.locationId], references: [locations.id] }),
}));
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  invoices: many(supplierInvoices),
  payments: many(supplierPayments),
}));
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  location: one(locations, { fields: [purchaseOrders.locationId], references: [locations.id] }),
  items: many(purchaseOrderItems),
  receipts: many(goodsReceipts),
}));
export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  po: one(purchaseOrders, { fields: [purchaseOrderItems.poId], references: [purchaseOrders.id] }),
  variant: one(productVariants, { fields: [purchaseOrderItems.variantId], references: [productVariants.id] }),
}));
export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  po: one(purchaseOrders, { fields: [goodsReceipts.poId], references: [purchaseOrders.id] }),
  supplier: one(suppliers, { fields: [goodsReceipts.supplierId], references: [suppliers.id] }),
  items: many(goodsReceiptItems),
}));
export const goodsReceiptItemsRelations = relations(goodsReceiptItems, ({ one }) => ({
  receipt: one(goodsReceipts, { fields: [goodsReceiptItems.receiptId], references: [goodsReceipts.id] }),
  variant: one(productVariants, { fields: [goodsReceiptItems.variantId], references: [productVariants.id] }),
}));
export const supplierInvoicesRelations = relations(supplierInvoices, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [supplierInvoices.supplierId], references: [suppliers.id] }),
  payments: many(supplierPayments),
}));
export const supplierPaymentsRelations = relations(supplierPayments, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierPayments.supplierId], references: [suppliers.id] }),
  invoice: one(supplierInvoices, { fields: [supplierPayments.invoiceId], references: [supplierInvoices.id] }),
}));
export const cartsRelations = relations(carts, ({ many, one }) => ({
  items: many(cartItems),
  customer: one(customers, { fields: [carts.customerId], references: [customers.id] }),
}));
export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, { fields: [cartItems.variantId], references: [productVariants.id] }),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
  events: many(orderEvents),
  payments: many(payments),
  attempts: many(paymentAttempts),
  refunds: many(refunds),
  documents: many(documents),
  delivery: one(deliveries, { fields: [orders.id], references: [deliveries.orderId] }),
  zone: one(deliveryZones, { fields: [orders.deliveryZoneId], references: [deliveryZones.id] }),
  location: one(locations, { fields: [orders.locationId], references: [locations.id] }),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, { fields: [orderItems.variantId], references: [productVariants.id] }),
}));
export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
  order: one(orders, { fields: [paymentAttempts.orderId], references: [orders.id] }),
}));
export const refundsRelations = relations(refunds, ({ one, many }) => ({
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
  items: many(refundItems),
}));
export const refundItemsRelations = relations(refundItems, ({ one }) => ({
  refund: one(refunds, { fields: [refundItems.refundId], references: [refunds.id] }),
  orderItem: one(orderItems, { fields: [refundItems.orderItemId], references: [orderItems.id] }),
}));
export const documentsRelations = relations(documents, ({ one }) => ({
  order: one(orders, { fields: [documents.orderId], references: [orders.id] }),
}));
export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  order: one(orders, { fields: [deliveries.orderId], references: [orders.id] }),
  zone: one(deliveryZones, { fields: [deliveries.zoneId], references: [deliveryZones.id] }),
}));
export const posSessionsRelations = relations(posSessions, ({ one, many }) => ({
  cashier: one(users, { fields: [posSessions.cashierId], references: [users.id] }),
  location: one(locations, { fields: [posSessions.locationId], references: [locations.id] }),
  cashMovements: many(cashMovements),
  suspendedSales: many(suspendedSales),
}));
export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  session: one(posSessions, { fields: [cashMovements.sessionId], references: [posSessions.id] }),
}));
export const suspendedSalesRelations = relations(suspendedSales, ({ one }) => ({
  session: one(posSessions, { fields: [suspendedSales.sessionId], references: [posSessions.id] }),
}));
export const expensesRelations = relations(expenses, ({ one }) => ({
  category: one(expenseCategories, { fields: [expenses.categoryId], references: [expenseCategories.id] }),
  supplier: one(suppliers, { fields: [expenses.supplierId], references: [suppliers.id] }),
}));
export const reviewsRelations = relations(reviews, ({ one, many }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  customer: one(customers, { fields: [reviews.customerId], references: [customers.id] }),
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
  reports: many(reviewReports),
}));
export const reviewReportsRelations = relations(reviewReports, ({ one }) => ({
  review: one(reviews, { fields: [reviewReports.reviewId], references: [reviews.id] }),
}));
export const productQuestionsRelations = relations(productQuestions, ({ one }) => ({
  product: one(products, { fields: [productQuestions.productId], references: [products.id] }),
}));
export const supportTicketsRelations = relations(supportTickets, ({ one, many }) => ({
  customer: one(customers, { fields: [supportTickets.customerId], references: [customers.id] }),
  order: one(orders, { fields: [supportTickets.orderId], references: [orders.id] }),
  messages: many(ticketMessages),
}));
export const ticketMessagesRelations = relations(ticketMessages, ({ one }) => ({
  ticket: one(supportTickets, { fields: [ticketMessages.ticketId], references: [supportTickets.id] }),
}));
export const promotionsRelations = relations(promotions, ({ many }) => ({ redemptions: many(promotionRedemptions) }));
export const promotionRedemptionsRelations = relations(promotionRedemptions, ({ one }) => ({
  promotion: one(promotions, { fields: [promotionRedemptions.promotionId], references: [promotions.id] }),
  order: one(orders, { fields: [promotionRedemptions.orderId], references: [orders.id] }),
}));
export const dataRequestsRelations = relations(dataRequests, ({ one }) => ({
  customer: one(customers, { fields: [dataRequests.customerId], references: [customers.id] }),
}));

/** Uploaded files kept in the database (STORAGE_DRIVER=db). For hosts without a persistent disk. */
export const storedFiles = pgTable(
  "stored_files",
  {
    visibility: text("visibility").notNull(),
    key: text("key").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    body: bytea("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.visibility, t.key] })],
);
