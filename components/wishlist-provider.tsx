"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getWishlist, toggleWishlist } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

interface WishlistContextValue {
  ids: string[];
  loading: boolean;
  isSaved: (studioId: string) => boolean;
  toggle: (studioId: string) => Promise<boolean>;
}

function applyOverlays(ids: string[], overlays: Map<string, boolean>) {
  const next = new Set(ids);
  overlays.forEach((saved, studioId) => {
    if (saved) next.add(studioId);
    else next.delete(studioId);
  });
  return [...next];
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const idsRef = useRef<string[]>([]);
  const pendingRef = useRef(new Map<string, number>());
  const generationsRef = useRef<Record<string, number>>({});
  const sessionGenerationRef = useRef(0);
  const hydratedRef = useRef(false);
  const hydrationFailedRef = useRef(false);
  const hydrationErrorShownRef = useRef(false);
  const serverIdsRef = useRef<string[] | null>(null);
  const hydrationPromiseRef = useRef<{
    sessionGeneration: number;
    promise: Promise<void>;
  } | null>(null);
  const retryHydrationRef = useRef<(() => Promise<boolean>) | null>(null);
  const retryPromiseRef = useRef<{
    sessionGeneration: number;
    promise: Promise<boolean>;
  } | null>(null);
  const overlaysRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    let active = true;
    const sessionGeneration = ++sessionGenerationRef.current;
    pendingRef.current.clear();
    overlaysRef.current.clear();
    hydratedRef.current = false;
    hydrationFailedRef.current = false;
    hydrationErrorShownRef.current = false;
    serverIdsRef.current = null;
    retryPromiseRef.current = null;
    if (!user) {
      idsRef.current = [];
      setIds([]);
      setLoading(false);
      hydrationPromiseRef.current = null;
      retryHydrationRef.current = null;
      retryPromiseRef.current = null;
      return;
    }

    let resolveHydration = () => {};
    const hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });
    hydrationPromiseRef.current = { sessionGeneration, promise: hydrationPromise };
    setLoading(true);
    const loadWishlist = async (showError: boolean): Promise<boolean> => {
      try {
        const next = await getWishlist(user.email);
        if (
          !active ||
          sessionGenerationRef.current !== sessionGeneration
        ) return false;
        hydratedRef.current = true;
        hydrationFailedRef.current = false;
        serverIdsRef.current = next;
        idsRef.current = applyOverlays(next, overlaysRef.current);
        setIds(idsRef.current);
        return true;
      } catch (error) {
        if (
          !active ||
          sessionGenerationRef.current !== sessionGeneration
        ) return false;
        hydratedRef.current = false;
        hydrationFailedRef.current = true;
        if (showError && !hydrationErrorShownRef.current) {
          hydrationErrorShownRef.current = true;
          toast.error("Couldn't load your shortlist", {
            description: error instanceof Error ? error.message : undefined,
          });
        }
        return false;
      } finally {
        if (
          active &&
          sessionGenerationRef.current === sessionGeneration
        ) {
          setLoading(false);
        }
      }
    };

    retryHydrationRef.current = () => {
      setLoading(true);
      return loadWishlist(true);
    };

    void loadWishlist(true).finally(() => {
      if (active && sessionGenerationRef.current === sessionGeneration) {
        resolveHydration();
      }
    });
    return () => {
      active = false;
      resolveHydration();
    };
  }, [user]);

  const isSaved = useCallback((studioId: string) => ids.includes(studioId), [ids]);

  const toggle = useCallback(
    async (studioId: string) => {
      if (!user) {
        toast.error("Save studios once you've logged in", {
          description: "Create a free account to keep a shortlist of spaces.",
        });
        return false;
      }
      const sessionGeneration = sessionGenerationRef.current;
      if (pendingRef.current.get(studioId) === sessionGeneration) {
        return idsRef.current.includes(studioId);
      }

      const hydration = hydrationPromiseRef.current;
      if (!hydratedRef.current && hydration?.sessionGeneration === sessionGeneration) {
        await hydration.promise;
      }
      if (sessionGenerationRef.current !== sessionGeneration) return false;
      if (!hydratedRef.current && hydrationFailedRef.current) {
        const existingRetry = retryPromiseRef.current;
        let retryPromise: Promise<boolean>;
        if (
          existingRetry?.sessionGeneration === sessionGeneration
        ) {
          retryPromise = existingRetry.promise;
        } else {
          const retry = (async () => {
            if (sessionGenerationRef.current !== sessionGeneration) return false;
            return (await retryHydrationRef.current?.()) === true;
          })();
          retryPromise = retry;
          const retryRecord = { sessionGeneration, promise: retryPromise };
          retryPromiseRef.current = retryRecord;
          void retryPromise.finally(() => {
            if (retryPromiseRef.current === retryRecord) {
              retryPromiseRef.current = null;
            }
          });
        }
        const retrySucceeded = await retryPromise;
        if (!retrySucceeded || sessionGenerationRef.current !== sessionGeneration) {
          return false;
        }
      }
      if (pendingRef.current.get(studioId) === sessionGeneration) {
        return idsRef.current.includes(studioId);
      }

      const wasSaved = idsRef.current.includes(studioId);
      const nextSaved = !wasSaved;
      const generation = (generationsRef.current[studioId] ?? 0) + 1;
      generationsRef.current[studioId] = generation;
      pendingRef.current.set(studioId, sessionGeneration);
      overlaysRef.current.set(studioId, nextSaved);

      const optimisticIds = nextSaved
        ? [...idsRef.current.filter((id) => id !== studioId), studioId]
        : idsRef.current.filter((id) => id !== studioId);
      idsRef.current = optimisticIds;
      setIds(optimisticIds);

      try {
        const result = await toggleWishlist(user.email, studioId);
        if (
          sessionGenerationRef.current !== sessionGeneration ||
          generationsRef.current[studioId] !== generation
        ) return result.saved;

        overlaysRef.current.set(studioId, result.saved);
        if (serverIdsRef.current) {
          serverIdsRef.current = result.saved
            ? [...serverIdsRef.current.filter((id) => id !== studioId), studioId]
            : serverIdsRef.current.filter((id) => id !== studioId);
        }
        overlaysRef.current.delete(studioId);
        const reconciledIds = applyOverlays(serverIdsRef.current ?? idsRef.current, overlaysRef.current);
        idsRef.current = reconciledIds;
        setIds(reconciledIds);
        toast.success(wasSaved ? "Removed from your shortlist" : "Saved to your shortlist", {
          description: wasSaved
            ? "You can always add it back from the studio page."
            : "Find all your saved spaces under Wishlist.",
        });
        return result.saved;
      } catch (error) {
        if (
          sessionGenerationRef.current === sessionGeneration &&
          generationsRef.current[studioId] === generation
        ) {
          overlaysRef.current.delete(studioId);
          const rolledBackIds = applyOverlays(serverIdsRef.current ?? idsRef.current, overlaysRef.current);
          idsRef.current = rolledBackIds;
          setIds(rolledBackIds);
        }
        if (sessionGenerationRef.current === sessionGeneration) {
          toast.error("Couldn't update your shortlist", {
            description: error instanceof Error ? error.message : undefined,
          });
        }
        return wasSaved;
      } finally {
        if (pendingRef.current.get(studioId) === sessionGeneration) {
          pendingRef.current.delete(studioId);
        }
      }
    },
    [user],
  );

  const value = useMemo(
    () => ({ ids, loading, isSaved, toggle }),
    [ids, loading, isSaved, toggle],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used inside WishlistProvider");
  return context;
}
