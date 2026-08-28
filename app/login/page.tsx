import LoginForm from '@/app/components/LoginForm';

/**
 * Server component.
 *
 * The form was previously a client component reading ?error and ?callbackUrl
 * with useSearchParams, which forces its whole subtree to render on the client
 * — the server sent an empty Suspense fallback and the user saw a blank screen
 * until hydration. Reading the query string here instead means the form is in
 * the initial HTML.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;

  // Only ever follow a same-origin relative path, never an absolute URL
  // someone put in the query string.
  const callbackUrl =
    params.callbackUrl?.startsWith('/') && !params.callbackUrl.startsWith('//')
      ? params.callbackUrl
      : '/';

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <LoginForm initialError={params.error} callbackUrl={callbackUrl} />
    </div>
  );
}
