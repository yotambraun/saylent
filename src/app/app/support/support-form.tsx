"use client";
// The in-app support form. Posts to /api/support,
// which creates a tracked support_requests row and auto-attaches the user's run/
// brand context server-side. Loading / success / error states all covered; the
// confirmation is honest ("we'll reply by email"), not a fake ticket number.
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";

export function SupportForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (body.trim().length < 10) {
      return setError("Please describe your issue (at least a sentence).");
    }
    setState("sending");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, subject, body }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) return setState("sent");
      setError(data.error ?? "Something went wrong. Please try again.");
      setState("error");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Thanks, we&apos;ve got it</CardTitle>
          <CardDescription>
            We&apos;ll reply to {email || "your account email"} as soon as we can. There&apos;s
            nothing else you need to do.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-2">
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Reply-to email</Label>
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
            <Label htmlFor="subject">Subject (optional)</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary"
              maxLength={200}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="body">How can we help? *</Label>
            <textarea
              id="body"
              required
              rows={6}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError(null);
              }}
              placeholder="Describe what happened, what you expected, and anything you've already tried."
              maxLength={4000}
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-signal/40"
            />
          </div>
          {error && <p className="text-sm text-pill-dismissed">{error}</p>}
          <Button type="submit" disabled={state === "sending"} className="justify-self-start">
            {state === "sending" ? "Sending…" : "Send message"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
