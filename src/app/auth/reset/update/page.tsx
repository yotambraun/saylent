// /auth/reset/update — step 2: set the new password. Reached from the emailed
// recovery link after /auth/callback exchanged the code for a session, so the
// page itself needs no token: updateUser writes against the live session.
import Link from "next/link";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata = { title: "Set a new password · Saylent" };

export default function UpdatePasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <Link href="/" className="font-display text-3xl font-semibold tracking-tight">
        Saylent
      </Link>
      <UpdatePasswordForm />
    </main>
  );
}
