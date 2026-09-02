"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AuthShell } from "@/features/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GeometricCircle } from "@/components/memphis/memphis-decorations";
import { useRedirectIfAuthed } from "@/features/auth/use-redirect-if-authed";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";

  // Client-side redirect: if already signed in, go to /dashboard.
  useRedirectIfAuthed();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [confirmationNeeded, setConfirmationNeeded] = useState(false);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!email) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Please enter a valid email address.";
    if (!password) next.password = "Password is required.";
    else if (password.length < 8)
      next.password = "Password must be at least 8 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    const { data, error } = await supabaseBrowser.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTarget)}`,
      },
    });

    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        toast.error("An account with this email already exists.", {
          description: "Try signing in instead.",
        });
      } else if (msg.includes("rate") || msg.includes("limit")) {
        toast.error("Too many attempts. Please wait a minute and try again.");
      } else if (msg.includes("weak") || msg.includes("password")) {
        toast.error("Password is too weak.", {
          description: "Use at least 8 characters with a mix of letters and numbers.",
        });
      } else {
        toast.error("Could not create your account.", { description: error.message });
      }
      return;
    }

    if (data.session) {
      toast.success("Account created!", { description: "Welcome to FormNull." });
      router.push(redirectTarget);
      router.refresh();
      return;
    }

    setConfirmationNeeded(true);
  }

  if (confirmationNeeded) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="We sent a verification link to confirm your account."
      >
        <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-6">
          <GeometricCircle color="coral" size={32} className="-top-3 -right-3 opacity-80" />
          <div className="relative space-y-3">
            <p className="text-sm">
              We sent an email to <strong className="text-foreground">{email}</strong>.
              Click the link inside to verify your account and finish signing in.
            </p>
            <p className="text-xs text-muted-foreground">
              Didn&apos;t get the email? Check your spam folder, or wait a minute
              and{" "}
              <button
                onClick={() => setConfirmationNeeded(false)}
                className="font-semibold text-foreground underline underline-offset-2 hover:text-[color:var(--memphis-coral)]"
              >
                try again
              </button>
              .
            </p>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free forever for solo use. No credit card required."
      footer={
        <>
          Already have an account?{" "}
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
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="h-11"
          />
          {errors.email && (
            <p id="email-error" className="text-xs font-medium text-destructive">
              {errors.email}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : "password-hint"}
            className="h-11"
          />
          {errors.password ? (
            <p id="password-error" className="text-xs font-medium text-destructive">
              {errors.password}
            </p>
          ) : (
            <p id="password-hint" className="text-xs text-muted-foreground">
              Use 8+ characters with a mix of letters and numbers.
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
          {loading ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          By signing up, you agree to our Terms of Service and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}
