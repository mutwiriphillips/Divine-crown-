import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function Forbidden() {
  return (
    <EmptyState title="You don't have access to this page" action={<Link className="btn-secondary" href="/admin">Back to overview</Link>}>
      Your role doesn&apos;t include this area. Ask the owner if you need it.
    </EmptyState>
  );
}
