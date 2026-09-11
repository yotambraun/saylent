"use client";
// Delete account — type-DELETE to confirm, quiet isolation (no red box for its
// own sake). POSTs /api/account/delete → sign out → home.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { SettingRow } from "../setting-row";

export function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (res.status === 204) {
        await createClient().auth.signOut();
        router.push("/");
        return;
      }
      setError("Deletion failed. Try again or contact us.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingRow
      label="Delete account"
      description={
        <>
          Permanently removes {email ? <span className="font-mono">{email}</span> : "your account"} and
          every brand, run, answer and fix. There is no undo.
        </>
      }
      stack
    >
      <div className="grid gap-2">
        <Label htmlFor="delete-confirm" className="text-sm text-wire">
          Type <span className="font-mono">DELETE</span> to confirm
        </Label>
        <Input
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          className="sm:max-w-xs"
        />
        <Button
          variant="outline"
          className="w-fit border-pill-dismissed text-pill-dismissed hover:bg-pill-dismissed hover:text-paper"
          disabled={typed !== "DELETE" || busy}
          onClick={deleteAccount}
        >
          {busy ? "Deleting…" : "Delete account"}
        </Button>
        {error && <p className="text-sm text-pill-dismissed">{error}</p>}
      </div>
    </SettingRow>
  );
}
