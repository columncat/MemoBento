import { Dashboard } from "@/components/dashboard";
import { appUrls } from "@/lib/app-urls";
import { isExternalLegacy } from "@/lib/legacy-store";
import { listNotebooks } from "@/lib/memo-server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return (
    <Dashboard
      initialNotebooks={listNotebooks()}
      legacySynced={isExternalLegacy()}
      appUrls={appUrls()}
    />
  );
}
