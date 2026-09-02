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
import { useRedirectIfAuthed } from "@/features/auth/use-redirect-if-authed";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") ?? "/dashboard";
  const errorParam = searchParams.get("error");

  // Client-side redirect: if already signed in, go to /dashboard.
  // This replaces the old proxy-level redirect that caused redirect loops.
  useRedirectIfAuthed();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  // Show one-time error toast if redirected here with ?error=
  if (errorParam === "verification_failed" && typeof window !== "undefined") {
    // Use a flag to ensure it only shows once per session
    if (!sessionStorage.getItem("formnull_verification_error_shown")) {
      sessionStorage.setItem("formnull_verification_error_shown", "1");
      setTimeout(() => {
        toast.error("Email verification failed.", {
          description: "The link may have expired. Please request a new one.",
        });
      }, 0);
    }
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!email) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Please enter a valid email address.";
    if (!password) next.password = "Password is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    const { data, error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid") || msg.includes("credentials")) {
        toast.error("Invalid email or password.", {
          description: "Please check your credentials and try again.",
        });
      } else if (msg.includes("rate") || msg.includes("limit")) {
        toast.error("Too many attempts. Please wait a minute and try again.");
      } else if (msg.includes("not confirmed") || msg.includes("email")) {
        toast.error("Please verify your email before signing in.", {
          description: "Check your inbox for the verification link.",
        });
      } else {
        toast.error("Could not sign you in.", { description: error.message });
      }
      return;
    }

    if (data.user) {
      toast.success("Welcome back!");
      router.push(redirectTarget);
      router.refresh();
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your FormNull account."
      footer={
        <div className="flex flex-col gap-2">
          <div>
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-semibold text-foreground underline underline-offset-2 hover:text-[color:var(--memphis-coral)]"
            >
              Sign up
            </Link>
          </div>
          <div>
            Forgot your password?{" "}
            <Link
              href="/forgot-password"
              className="font-semibold text-foreground underline underline-offset-2 hover:text-[color:var(--memphis-coral)]"
            >
              Reset it
            </Link>
          </div>
        </div>
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
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            className="h-11"
          />
          {errors.password && (
            <p id="password-error" className="text-xs font-medium text-destructive">
              {errors.password}
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
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
