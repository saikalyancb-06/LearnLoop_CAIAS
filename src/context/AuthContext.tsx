import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { authService } from "../services/authService";
import { supabase } from "../lib/supabaseClient";
import type { TableRow } from "../types/database";
import { isSessionCacheFresh, readSessionCache, writeSessionCache } from "../lib/cache";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: TableRow<"profiles"> | null;
  isLoading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

const AUTH_CACHE_MAX_AGE = 1000 * 60 * 30;

async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function ensureProfile(nextUser: User) {
  try {
    return await fetchProfile(nextUser.id);
  } catch {
    return authService.upsertProfile({
      id: nextUser.id,
      email: nextUser.email ?? null,
      full_name:
        (nextUser.user_metadata.full_name as string | undefined) ??
        (nextUser.user_metadata.name as string | undefined) ??
        null,
      avatar_url: (nextUser.user_metadata.avatar_url as string | undefined) ?? null,
    });
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(() => readSessionCache("auth.session"));
  const [user, setUser] = useState<User | null>(() => readSessionCache("auth.user"));
  const [profile, setProfile] = useState<TableRow<"profiles"> | null>(() => readSessionCache("auth.profile"));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const skipNextInitialSessionRef = useRef(false);

  const syncProfile = useCallback(async (nextUser: User | null, shouldEnsure = false) => {
    if (!nextUser) {
      setProfile(null);
      writeSessionCache("auth.profile", null);
      return;
    }

    try {
      const nextProfile = shouldEnsure
        ? await ensureProfile(nextUser)
        : await fetchProfile(nextUser.id);
      setProfile(nextProfile);
      writeSessionCache("auth.profile", nextProfile);
    } catch (profileError) {
      setError(
        profileError instanceof Error
          ? profileError.message
          : "Unable to load profile.",
      );
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const hasFreshCachedAuth =
      isSessionCacheFresh("auth.session", AUTH_CACHE_MAX_AGE) &&
      isSessionCacheFresh("auth.user", AUTH_CACHE_MAX_AGE) &&
      isSessionCacheFresh("auth.profile", AUTH_CACHE_MAX_AGE);

    async function bootstrapAuth() {
      if (hasFreshCachedAuth) {
        skipNextInitialSessionRef.current = true;
        setIsLoading(false);
        return;
      }

      try {
        const currentSession = await authService.getSession();

        if (!isMounted) {
          return;
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        writeSessionCache("auth.session", currentSession);
        writeSessionCache("auth.user", currentSession?.user ?? null);
        if (isSessionCacheFresh("auth.profile", AUTH_CACHE_MAX_AGE)) {
          setProfile(readSessionCache("auth.profile"));
        } else {
          await syncProfile(currentSession?.user ?? null, false);
        }
      } catch (sessionError) {
        if (!isMounted) {
          return;
        }

        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "Unable to load authentication state.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void bootstrapAuth();

    const {
      data: { subscription },
    } = authService.onAuthStateChange((event: AuthChangeEvent, nextSession) => {
      if (event === "INITIAL_SESSION" && skipNextInitialSessionRef.current) {
        skipNextInitialSessionRef.current = false;
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      writeSessionCache("auth.session", nextSession);
      writeSessionCache("auth.user", nextSession?.user ?? null);
      setIsLoading(false);
      setError(null);

      if (
        event === "INITIAL_SESSION" &&
        nextSession?.user &&
        isSessionCacheFresh("auth.profile", AUTH_CACHE_MAX_AGE)
      ) {
        setProfile(readSessionCache("auth.profile"));
        return;
      }

      const shouldEnsureProfile =
        event === "SIGNED_IN" ||
        event === "USER_UPDATED";

      if (event === "TOKEN_REFRESHED" && isSessionCacheFresh("auth.profile", AUTH_CACHE_MAX_AGE)) {
        setProfile(readSessionCache("auth.profile"));
        return;
      }

      void syncProfile(nextSession?.user ?? null, shouldEnsureProfile);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [syncProfile]);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      writeSessionCache("auth.profile", null);
      return;
    }

    const nextProfile = await fetchProfile(user.id);
    setProfile(nextProfile);
    writeSessionCache("auth.profile", nextProfile);
  }, [user]);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setProfile(null);
    writeSessionCache("auth.session", null);
    writeSessionCache("auth.user", null);
    writeSessionCache("auth.profile", null);
  }, []);

  useEffect(() => {
    const darkMode =
      typeof profile?.preferences === "object" &&
      profile.preferences &&
      "darkMode" in profile.preferences
        ? Boolean(profile.preferences.darkMode)
        : readSessionCache<boolean>("theme.darkMode", 1000 * 60 * 60 * 24 * 30) ?? false;

    document.documentElement.classList.toggle("dark", darkMode);
    writeSessionCache("theme.darkMode", darkMode);
  }, [profile]);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      isLoading,
      error,
      refreshProfile,
      signOut,
    }),
    [error, isLoading, profile, refreshProfile, session, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
