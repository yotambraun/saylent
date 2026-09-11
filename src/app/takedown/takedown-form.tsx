"use client";
// The public takedown intake form. Posts to the
// submitTakedown server action; loading/empty/success/error states covered.
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { submitTakedown } from "./actions";

export function TakedownForm({ token }: { token?: string }) {
  const [email, setEmail] = useState("");
  const [claim, setClaim] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (claim.trim().length < 10) {
      return setError("Please describe the issue (at least a sentence).");
    }
    setState("sending");
    const res = await submitTakedown({ reporterEmail: email, claim, token });
    if (res.ok) return setState("sent");
    setError(res.error ?? "Something went wrong. Please try again.");
    setState("error");
  }

  if (state === "sent") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display">Thanks. We&apos;ve got it</CardTitle>
          <CardDescription>
            We&apos;ll review your request and get back to you if you left an email.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Request a review</CardTitle>
        <CardDescription>
          If a Saylent report is about your company and you didn&apos;t authorize it, tell us
          here. We review every request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Your email (optional: so we can reply)</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="claim">What&apos;s the issue? *</Label>
            <textarea
              id="claim"
              required
              rows={5}
              value={claim}
              onChange={(e) => {
                setClaim(e.target.value);
                setError(null);
              }}
              placeholder="Tell us which brand/report this is about and why you're requesting a review."
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-signal/40"
            />
          </div>
          {error && <p className="text-sm text-pill-dismissed">{error}</p>}
          <Button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Submit request"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
