/**
 * Treat blank environment variables as unset.
 *
 * .env.example lists every variable with an empty value, and hosting dashboards often keep empty entries.
 * Without this, `process.env.X ?? default` would see "" instead of falling back to the default
 * (e.g. STORAGE_DIR="" would write uploads to the wrong folder, DATABASE_POOL_MAX="" would mean 0).
 * Imported first by the database module, the instrumentation hook and the scripts.
 */
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string" && v.trim() === "") delete process.env[k];
}
export {};
