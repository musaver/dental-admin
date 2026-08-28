import PortalActivate from '@/app/components/PortalActivate';

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <PortalActivate token={params.token ?? ''} />;
}
