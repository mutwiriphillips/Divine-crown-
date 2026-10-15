import type { Permission } from "@/lib/permissions";

export type NavItem = { href: string; label: string; perm?: Permission };
export type NavGroup = { label: string; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Sell",
    items: [
      { href: "/admin", label: "Overview", perm: "dashboard.view" },
      { href: "/admin/pos", label: "Point of sale", perm: "pos.use" },
      { href: "/admin/orders", label: "Orders", perm: "orders.view" },
      { href: "/admin/payments", label: "Payments", perm: "payments.reconcile" },
      { href: "/admin/delivery", label: "Delivery", perm: "delivery.manage" },
    ],
  },
  {
    label: "Catalogue & stock",
    items: [
      { href: "/admin/products", label: "Products", perm: "products.view" },
      { href: "/admin/categories", label: "Categories", perm: "products.edit" },
      { href: "/admin/media", label: "Image library", perm: "products.edit" },
      { href: "/admin/inventory", label: "Stock", perm: "inventory.view" },
      { href: "/admin/purchasing", label: "Purchase orders", perm: "purchasing.manage" },
      { href: "/admin/suppliers", label: "Suppliers", perm: "purchasing.manage" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", perm: "customers.view" },
      { href: "/admin/feedback", label: "Reviews & questions", perm: "feedback.moderate" },
      { href: "/admin/support", label: "Support requests", perm: "support.manage" },
      { href: "/admin/promotions", label: "Promotions", perm: "promotions.manage" },
    ],
  },
  {
    label: "Money & reports",
    items: [
      { href: "/admin/pos/shifts", label: "Till shifts", perm: "pos.use" },
      { href: "/admin/expenses", label: "Expenses", perm: "expenses.create" },
      { href: "/admin/reports", label: "Reports", perm: "reports.sales" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/settings", label: "Business & store", perm: "settings.business" },
      { href: "/admin/settings/commerce", label: "Tax, checkout & receipts", perm: "settings.financial" },
      { href: "/admin/settings/staff", label: "Staff & roles", perm: "staff.manage" },
      { href: "/admin/settings/notifications", label: "Notifications", perm: "notifications.manage" },
      { href: "/admin/settings/privacy", label: "Privacy requests", perm: "customers.export" },
      { href: "/admin/settings/audit", label: "Audit log", perm: "audit.view" },
      { href: "/admin/settings/integrations", label: "Integrations", perm: "settings.financial" },
    ],
  },
];
