import { fetchS3BucketObjectsSSR } from "@/lib/server-fetch";
import { normalizeS3PrefixParam } from "@/lib/s3-prefix-param";
import { S3ImportPickerClient } from "@/components/s3/S3ImportPickerClient";

export default async function S3ImportPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; prefix?: string; requireTarGz?: string }>;
}) {
  const sp = await searchParams;
  const name = typeof sp.name === "string" ? sp.name.trim() : "";
  const requireTarGz = sp.requireTarGz === "1" || sp.requireTarGz === "true";
  if (!name) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Missing <code className="text-[11px] bg-muted px-1 rounded">name</code> (S3 destination).
      </div>
    );
  }

  const prefixParam = normalizeS3PrefixParam(sp.prefix);
  const initialList = await fetchS3BucketObjectsSSR(name, prefixParam);

  return (
    <div className="min-h-0 p-3 sm:p-4">
      <S3ImportPickerClient
        key={`${name}:${prefixParam}`}
        profileName={name}
        initialPrefix={prefixParam}
        initialList={initialList}
        requireTarGz={requireTarGz}
      />
    </div>
  );
}
