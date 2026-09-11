// A self-hosted
// deployment must not show OUR marketing at "/": root redirects straight into the
// product. Pure so the branch is unit-testable without a Supabase client.
export function resolveRootRedirect(user: unknown): "/app" | "/login" {
  return user ? "/app" : "/login";
}
