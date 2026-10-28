"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseLngLat } from "@emerald-city/core";
import { HubIdError } from "@emerald-city/hubid-client";
import { hubid, territory } from "@/lib/hubid";
import { clearSession, getSession, setSessionToken } from "@/lib/session";

export interface FormState {
  error?: string;
  /** Submitted values, echoed back so fields survive React's post-action form reset. Never includes passwords. */
  values?: { email?: string; name?: string; isPrivate?: boolean; lat?: number; lng?: number };
}

function propertyValues(form: FormData): FormState["values"] {
  const loc = parseLngLat(form.get("lat"), form.get("lng"));
  return { name: String(form.get("name") ?? ""), isPrivate: form.get("private") === "on", lat: loc?.lat, lng: loc?.lng };
}

/** Only allow same-site relative redirects after login. */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/my-properties";
}

function hubError(err: unknown, fallback: string): string {
  if (err instanceof HubIdError) {
    if (err.status === 401 || err.status === 403) return "HubID says you don't have permission to do that.";
    if (err.status === 422) return "HubID rejected that. A property with this name may already exist.";
    return `${fallback} (HubID ${err.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const values = { email };
  if (!email || !password) return { error: "Enter your HubID email and password.", values };
  try {
    const { token } = await hubid.login(email, password);
    await setSessionToken(token);
  } catch (err) {
    if (err instanceof HubIdError && err.status < 500) return { error: "That email and password didn't match a HubID.", values };
    return { error: "HubID is unavailable right now. Try again shortly.", values };
  }
  redirect(safeNext(form.get("next")));
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/");
}

function readLocation(form: FormData) {
  return parseLngLat(form.get("lat"), form.get("lng"));
}

export async function createProperty(_: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/login?next=/properties/new");
  const location = readLocation(form);
  if (!location) return { error: "Drop a pin on the map to place your property.", values: propertyValues(form) };
  let id: number;
  try {
    const p = await session.client.createProperty({
      name: String(form.get("name") ?? ""),
      location,
      isPrivate: form.get("private") === "on",
      timezone: String(form.get("timezone") ?? "") || undefined,
      territory,
    });
    id = p.id;
  } catch (err) {
    return { error: hubError(err, "Couldn't create the property."), values: propertyValues(form) };
  }
  revalidatePath("/my-properties");
  revalidatePath("/map");
  redirect(`/p/${id}`);
}

export async function updateProperty(id: number, _: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect(`/login?next=/p/${id}/edit`);
  const location = readLocation(form);
  if (!location) return { error: "Drop a pin on the map to place your property.", values: propertyValues(form) };
  try {
    await session.client.updateProperty(id, {
      name: String(form.get("name") ?? ""),
      location,
      isPrivate: form.get("private") === "on",
    });
  } catch (err) {
    return { error: hubError(err, "Couldn't save the property."), values: propertyValues(form) };
  }
  revalidatePath(`/p/${id}`);
  revalidatePath("/my-properties");
  revalidatePath("/map");
  redirect(`/p/${id}`);
}
