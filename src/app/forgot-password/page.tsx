"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AuthShell } from "@/features/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GeometricCircle } from "@/components/memphis/memphis-decorations";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      setError("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(undefined);
    setLoading(true);

    const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("rate") || msg.includes("limit")) {
        toast.error("Too many attempts. Please wait a minute and try again.");
        return;
      }
    }

    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="If an account exists for that address, a reset link is on its way."
      >
        <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-6">
          <GeometricCircle color="coral" size={32} className="-top-3 -right-3 opacity-80" />
          <div className="relative space-y-3">
            <p className="text-sm">
              We sent an email to <strong className="text-foreground">{email}</strong>.
              Click the link inside to choose a new password.
            </p>
            <p className="text-xs text-muted-foreground">
              Didn&apos;t get the email? Check your spam folder, or{" "}
              <button
                onClick={() => setSent(false)}
                className="font-semibold text-foreground underline underline-offset-2 hover:text-[color:var(--memphis-coral)]"
              >
                try a different address
              </button>
              .
            </p>
            <div className="pt-2">
              <Link
                href="/signin"
                className="text-sm font-semibold text-foreground underline underline-offset-2 hover:text-[color:var(--memphis-coral)]"
              >
                ← Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <>
          Remembered your password?{" "}
          <Link
            href="/signin"
            className="font-semibold text-foreground underline underline-offset-2 hover:text-[color:var(--memphis-coral)]"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            aria-invalid={!!error}
            aria-describedby={error ? "email-error" : undefined}
            className="h-11"
          />
          {error && (
            <p id="email-error" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="memphis-coral"
          size="lg"
          className="w-full"
          disabled={loading}
        >
          {loading ? "Sending reset link…" : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
