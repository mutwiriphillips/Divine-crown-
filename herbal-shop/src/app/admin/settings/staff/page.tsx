import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaffPage } from "@/lib/auth/server";
import { PERMISSIONS } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, fmtDate, PageHeader } from "@/components/ui";
import { createStaffAction, saveRoleAction, updateStaffAction } from "../actions";

export const metadata = { title: "Staff & roles" };

export default async function StaffPage() {
  const me = await requireStaffPage("staff.manage", "/admin/settings/staff");
  const roles = await db.select().from(schema.roles).orderBy(asc(schema.roles.name));
  const staffRoles = roles.filter((r) => r.isStaff);
  const users = await db
    .select({ u: schema.users, role: schema.roles })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(eq(schema.roles.isStaff, true))
    .orderBy(asc(schema.users.name));
  return (
    <>
      <PageHeader title="Staff & roles" description="Give each person their own account so the audit log shows who did what. Never share logins." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="card overflow-x-auto p-5">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Two-step</th><th /></tr></thead>
            <tbody>
              {users.map(({ u, role }) => (
                <tr key={u.id}>
                  <td>{u.name}<span className="block text-[12px] text-ink-soft">{u.email ?? u.phone}{u.isDemo ? " · sample" : ""}</span>{u.status === "DISABLED" ? <Badge tone="bad">Disabled</Badge> : null}</td>
                  <td>
                    <ActionForm action={updateStaffAction} className="flex gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="op" value="role" />
                      <select className="input input-sm" name="roleId" defaultValue={role.id} aria-label={`Role for ${u.name}`}>{staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                      <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                    </ActionForm>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(u.lastLoginAt, true)}</td>
                  <td>{u.mfaEnabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</td>
                  <td className="whitespace-nowrap">
                    {u.id !== me.id ? (
                      <span className="flex gap-1">
                        <ActionForm action={updateStaffAction} confirm={`${u.status === "ACTIVE" ? "Disable" : "Enable"} ${u.name}'s account?`}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="op" value={u.status === "ACTIVE" ? "disable" : "enable"} />
                          <SubmitButton className="btn-ghost btn-sm">{u.status === "ACTIVE" ? "Disable" : "Enable"}</SubmitButton>
                        </ActionForm>
                        <ActionForm action={updateStaffAction} confirm={`Reset ${u.name}'s password? They'll be signed out everywhere.`}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="op" value="reset" />
                          <SubmitButton className="btn-ghost btn-sm">Reset password</SubmitButton>
                        </ActionForm>
                      </span>
                    ) : <span className="text-ink-soft">You</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <ActionForm action={createStaffAction} className="card h-fit space-y-3 p-5" resetOnSuccess>
          <h2 className="text-lg">Add a staff member</h2>
          <input className="input" name="name" placeholder="Full name" required aria-label="Full name" />
          <input className="input" name="email" type="email" placeholder="Email (used to sign in)" required aria-label="Email" />
          <input className="input" name="phone" placeholder="Phone (optional)" aria-label="Phone" />
          <select className="input" name="roleId" defaultValue={staffRoles.find((r) => r.key === "CASHIER")?.id} aria-label="Role">{staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <SubmitButton>Create account</SubmitButton>
          <p className="text-[13px] text-ink-soft">A temporary password is shown once. Hand it over in person.</p>
        </ActionForm>
      </div>

      <h2 className="mb-3 mt-10 text-2xl">What each role can do</h2>
      <p className="mb-4 text-ink-soft">{me.roleKey === "OWNER" ? "Tick or untick to change a role. The owner always has everything." : "Only the owner can change roles."}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {staffRoles.filter((r) => r.key !== "OWNER").map((r) => (
          <ActionForm key={r.id} action={saveRoleAction} className="card p-5">
            <input type="hidden" name="id" value={r.id} />
            <h3 className="text-lg">{r.name}</h3>
            <p className="mb-3 text-sm text-ink-soft">{r.description}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {Object.entries(PERMISSIONS).map(([k, label]) => (
                <label key={k} className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" className="checkbox mt-0.5 h-4 w-4" name="perm" value={k} defaultChecked={r.permissions.includes(k)} disabled={me.roleKey !== "OWNER"} />
                  {label}
                </label>
              ))}
            </div>
            {me.roleKey === "OWNER" ? <div className="mt-3"><SubmitButton className="btn-secondary btn-sm">Save {r.name}</SubmitButton></div> : null}
          </ActionForm>
        ))}
      </div>
    </>
  );
}
