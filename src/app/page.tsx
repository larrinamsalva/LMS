import { Workspace } from "../components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <Workspace
      initialOrganizationId={
        typeof params.organizationId === "string"
          ? params.organizationId
          : undefined
      }
      previewMode={params.preview === "1"}
    />
  );
}
