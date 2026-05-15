import { EnterpriseInstanceLicensePanel } from "@/ee/enterprise-instance-license-panel";
import { fetchInstanceEnterpriseLicenseSSR } from "@/lib/server-fetch";

export default async function EnterpriseLicensePage() {
  const initialState = await fetchInstanceEnterpriseLicenseSSR();

  return (
    <div className="max-w-xl mr-auto">
      <div className="glass-panel rounded-2xl p-6 sm:p-7 space-y-6 text-left">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Enterprise license</h1>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            View status or paste the signed license token for this instance (instance administrators only).
          </p>
        </div>
        <EnterpriseInstanceLicensePanel initialState={initialState} />
      </div>
    </div>
  );
}
