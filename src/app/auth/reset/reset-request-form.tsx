"use client";
// Step 1 of the password reset: ask Supabase to email a recovery link.
//
// The success state is deliberately identical whether or not the address has an
// account — telling a stranger "no account with that email" turns this form into
// an account-enumeration oracle.
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { resetRedirectUrl } from "./reset";

export function ResetRequestForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectUrl(location.origin),
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display">Check your inbox</CardTitle>
          <CardDescription>If that address has an account, a reset link is on its way.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-wire">
            Sent to <span className="font-mono">{email}</span>. The link signs you in once, so you
            can set a new password. Nothing arrived?{" "}
            <button className="underline" onClick={() => setState("idle")}>
              Try again
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a link to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send reset link"}
          </Button>
          {state === "error" && (
            <p role="alert" className="text-sm text-pill-dismissed">
              Couldn&apos;t send the link. Check the address and try again. If this deployment has
              no email configured, ask your operator to reset it for you.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
