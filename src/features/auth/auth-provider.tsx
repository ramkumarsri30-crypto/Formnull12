"use client";

/**
 * FormNull — Auth Provider
 * =====================================================================
 * Wraps the app in a Supabase auth listener. Exposes:
 *   - user: Supabase User | null
 *   - profile: Profile row | null  (loaded from public.profiles)
 *   - loading: boolean
 *   - signOut(): Promise<void>
 *
 * The provider also synchronizes the profile row with the current user.
 * If migrations have been applied (profiles table exists + trigger),
 * the profile is loaded automatically. If not, profile is null and
 * the UI shows appropriate empty states.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabaseBrowser
        .from("profiles")
        .select("*")
        .eq("id", uid)
        .maybeSingle();
      if (error) {
        // Most likely the profiles table doesn't exist yet (migrations not applied).
        // Silently set profile to null — UI handles this gracefully.
        if (error.code !== "42P01" && error.code !== "PGRST205") {
          console.warn("[auth] failed to load profile:", error.message);
        }
        setProfile(null);
        return;
      }
      setProfile(data);
    } catch (e) {
      console.warn("[auth] profile load error:", e);
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  useEffect(() => {
    let mounted = true;

    // 1. Get initial session synchronously.
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        loadProfile(u.id).finally(() => mounted && setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // 2. Subscribe to auth changes (sign-in, sign-out, token refresh).
    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        loadProfile(u.id).finally(() => mounted && setLoading(false));
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabaseBrowser.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ user, profile, loading, signOut, refreshProfile }),
    [user, profile, loading, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
