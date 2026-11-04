import * as demo from "./demo-store";
import { authClient } from "./auth-client";
import type {
  Booking,
  BookingDraft,
  LoginInput,
  RegisterInput,
  Studio,
  StudioDraft,
  StudioQuery,
  User,
} from "./types";

const rawBase = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
const forceDemo = (process.env.NEXT_PUBLIC_DEMO_MODE ?? "").toLowerCase() === "true";

export const API_BASE_URL = rawBase;
export const isDemoMode = !rawBase || forceDemo;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      "We couldn't reach the StudioSpace server. Check your connection and try again.",
      503,
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && (data.message || data.error)) ||
      "Something went wrong. Please try again.";
    throw new ApiError(String(message), response.status);
  }

  return data as T;
}

function unwrap<T>(payload: unknown, key?: string): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    const inner = (payload as { data: unknown }).data;
    if (key && inner && typeof inner === "object" && key in inner) {
      return (inner as Record<string, unknown>)[key] as T;
    }
    return inner as T;
  }
  if (key && payload && typeof payload === "object" && key in payload) {
    return (payload as Record<string, unknown>)[key] as T;
  }
  return payload as T;
}

function toStudios(payload: unknown): Studio[] {
  const value = unwrap<unknown>(payload, "studios");
  const records = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "studios" in value
      ? (value as { studios: unknown[] }).studios ?? []
      : [];

  return records.map((record) => {
    const studio = record as Record<string, unknown>;
    return {
      ...(studio as unknown as Studio),
      _id: String(studio._id ?? studio.id ?? ""),
      image: String(studio.image ?? studio.imageURL ?? ""),
    };
  });
}

function toStudioPayload(draft: StudioDraft) {
  return {
    title: draft.title,
    category: draft.category,
    hourlyRate: draft.hourlyRate,
    securityDeposit: draft.securityDeposit,
    capacity: draft.capacity,
    location: draft.location,
    imageURL: draft.image,
    gallery: draft.gallery,
    amenities: draft.amenities,
    overview: draft.overview,
  };
}

function toStudio(payload: unknown): Studio {
  const studio = payload as Record<string, unknown>;
  return {
    ...(studio as unknown as Studio),
    _id: String(studio._id ?? studio.id ?? ""),
    image: String(studio.image ?? studio.imageURL ?? ""),
  };
}

function toBooking(payload: unknown): Booking {
  const booking = payload as Record<string, unknown>;
  const bookingDate = booking.date ?? booking.bookingDate;
  return {
    ...(booking as unknown as Booking),
    _id: String(booking._id ?? booking.id ?? ""),
    date: typeof bookingDate === "string" ? bookingDate : "",
    createdAt: typeof booking.createdAt === "string" ? booking.createdAt : "",
  };
}

function toBookings(payload: unknown): Booking[] {
  const value = unwrap<unknown>(payload, "bookings");
  return (Array.isArray(value) ? value : []).map(toBooking);
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export async function getSession(): Promise<User | null> {
  if (isDemoMode) return demo.demoGetSession();

  try {
    const payload = await request<unknown>("/auth/me");
    return unwrap<User | null>(payload, "user");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function login(input: LoginInput): Promise<User> {
  if (isDemoMode) return demo.demoLogin(input);
  const payload = await request<unknown>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return unwrap<User>(payload, "user");
}

export async function register(input: RegisterInput): Promise<User> {
  if (isDemoMode) return demo.demoRegister(input);
  const payload = await request<unknown>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return unwrap<User>(payload, "user");
}

export async function googleLogin(callbackURL?: string): Promise<User | null> {
  if (isDemoMode) return demo.demoGoogleLogin();

  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: callbackURL ?? window.location.origin,
  });
  if (error) throw new ApiError(error.message ?? "Google sign-in failed", 400);
  return null;
}

export async function logout(): Promise<void> {
  if (isDemoMode) return demo.demoLogout();

  try {
    await authClient.signOut();
  } finally {
    // Always attempt to clear the Express JWT cookie,
    // even if Better Auth sign-out fails.
    await request<unknown>("/auth/logout", { method: "POST" });
  }
}

/* ------------------------------------------------------------------ */
/* Studios                                                             */
/* ------------------------------------------------------------------ */

function toQueryString(query: StudioQuery) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  if (query.maxPrice) params.set("maxPrice", String(query.maxPrice));
  if (query.sort) params.set("sort", query.sort);
  const value = params.toString();
  return value ? `?${value}` : "";
}

export async function getStudios(query: StudioQuery = {}): Promise<Studio[]> {
  if (isDemoMode) return demo.demoGetStudios(query);
  return toStudios(await request<unknown>(`/studios${toQueryString(query)}`));
}

export async function getFeaturedStudios(limit = 6): Promise<Studio[]> {
  if (isDemoMode) return demo.demoGetFeaturedStudios(limit);
  const payload = await request<unknown>(
    `/studios?featured=true&sort=rating&limit=${limit}`,
  );
  return toStudios(payload).slice(0, limit);
}

export async function getStudio(id: string): Promise<Studio | null> {
  if (isDemoMode) return demo.demoGetStudio(id);
  try {
    const payload = await request<unknown>(`/studios/${id}`);
    const studio = unwrap<Studio>(payload, "studio");
    return studio ? toStudio(studio) : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getMyListings(email: string): Promise<Studio[]> {
  if (isDemoMode) return demo.demoGetMyListings(email);
  return toStudios(await request<unknown>("/studios/mine"));
}

export async function createStudio(draft: StudioDraft, user: User): Promise<Studio> {
  if (isDemoMode) return demo.demoCreateStudio(draft, user);
  const payload = await request<unknown>("/studios", {
    method: "POST",
    body: JSON.stringify(toStudioPayload(draft)),
  });
  return toStudio(unwrap<Studio>(payload, "studio"));
}

export async function updateStudio(
  id: string,
  draft: StudioDraft,
  user: User,
): Promise<Studio> {
  if (isDemoMode) return demo.demoUpdateStudio(id, draft, user);
  const payload = await request<unknown>(`/studios/${id}`, {
    method: "PATCH",
    body: JSON.stringify(toStudioPayload(draft)),
  });
  return toStudio(unwrap<Studio>(payload, "studio"));
}

export async function deleteStudio(id: string, user: User): Promise<void> {
  if (isDemoMode) return demo.demoDeleteStudio(id, user);
  await request<unknown>(`/studios/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

export async function getMyBookings(email: string): Promise<Booking[]> {
  if (isDemoMode) return demo.demoGetMyBookings(email);
  const payload = await request<unknown>("/bookings/mine");
  return toBookings(payload);
}

export async function getBooking(id: string): Promise<Booking | null> {
  if (isDemoMode) return demo.demoGetBooking(id);
  try {
    const payload = await request<unknown>(`/bookings/${id}`);
    return toBooking(unwrap<Booking>(payload, "booking"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function createBooking(
  draft: BookingDraft,
  user: User,
): Promise<Booking> {
  if (isDemoMode) return demo.demoCreateBooking(draft, user);
  const payload = await request<unknown>("/bookings", {
    method: "POST",
    body: JSON.stringify({
      ...draft,
      bookingDate: draft.date,
      date: undefined,
    }),
  });
  return toBooking(unwrap<Booking>(payload, "booking"));
}

export async function cancelBooking(id: string, user: User): Promise<Booking> {
  if (isDemoMode) return demo.demoCancelBooking(id, user);
  const payload = await request<unknown>(`/bookings/${id}/cancel`, {
    method: "PATCH",
  });
  return toBooking(unwrap<Booking>(payload, "booking"));
}

export async function getBookedSlots(studioId: string, date: string) {
  if (isDemoMode) return demo.demoGetBookedSlots(studioId, date);
  const payload = await request<unknown>(`/studios/${studioId}/availability?date=${date}`);
  return unwrap<
    { startTime: string; endTime: string; status: "Pending" | "Confirmed" }[]
  >(payload, "slots");
}

/* ------------------------------------------------------------------ */
/* Wishlist                                                            */
/* ------------------------------------------------------------------ */

export async function getWishlist(email: string): Promise<string[]> {
  if (isDemoMode) return demo.demoGetWishlist(email);
  const payload = await request<unknown>("/wishlist");
  const value = unwrap<unknown>(payload, "studioIds");
  if (Array.isArray(value)) return value.filter((id) => typeof id === "string") as string[];
  const studios = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (Array.isArray(studios)) {
    return studios
      .map((studio) => String((studio as Record<string, unknown>).id ?? (studio as Record<string, unknown>)._id ?? ""))
      .filter(Boolean);
  }
  return Array.isArray(value) ? (value as string[]) : [];
}

export async function toggleWishlist(
  email: string,
  studioId: string,
): Promise<string[]> {
  if (isDemoMode) return demo.demoToggleWishlist(email, studioId);
  const payload = await request<unknown>(`/wishlist/${studioId}/toggle`, { method: "POST" });
  const value = unwrap<unknown>(payload, "studioIds");
  return Array.isArray(value) ? (value as string[]) : [];
}

export function getGoogleAuthUrl() {
  return isDemoMode ? null : `${API_BASE_URL}/auth/google`;
}
