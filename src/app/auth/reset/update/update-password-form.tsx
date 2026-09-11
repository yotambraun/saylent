"use client";
// Step 2 of the password reset. The recovery link already put a session in the
// cookie (via /auth/callback), so this is a plain updateUser — no token handling
// here. If the link expired, updateUser fails and we say so rather than
// pretending the password changed.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { MIN_PASSWORD_LENGTH, newPasswordError } from "../reset";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = newPasswordError(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(
        `${updateError.message} If the link has expired, request a fresh one from the sign-in page.`,
      );
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Set a new password</CardTitle>
        <CardDescription>You&apos;re signed in from the emailed link. Pick a new password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-pill-dismissed">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
