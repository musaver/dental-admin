import PortalLoginForm from '@/app/components/PortalLoginForm';

/** Server component so the form is in the initial HTML. */
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next =
    params.next?.startsWith('/portal') && !params.next.startsWith('//')
      ? params.next
      : '/portal';

  return <PortalLoginForm next={next} />;
}
