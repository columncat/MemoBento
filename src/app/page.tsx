import { Dashboard } from "@/components/dashboard";
import { env } from "@/lib/env";
import { isExternalLegacy } from "@/lib/legacy-store";
import { listNotebooks } from "@/lib/memo-server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <Dashboard
      initialNotebooks={listNotebooks()}
      legacySynced={isExternalLegacy()}
      mailbentoUrl={env.MAILBENTO_URL?.trim() || null}
    />
  );
}
