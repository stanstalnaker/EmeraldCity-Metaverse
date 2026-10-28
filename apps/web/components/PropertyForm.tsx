"use client";

import { useActionState, useEffect, useState } from "react";
import { LocationPicker } from "@emerald-city/gaia-map";
import type { LngLat } from "@emerald-city/core";
import type { FormState } from "@/app/actions";
import { SubmitButton } from "./SubmitButton";

export interface PropertyFormProps {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  styleUrl: string;
  initial?: { name: string; location: LngLat | null; isPrivate: boolean };
  submitLabel: string;
}

export function PropertyForm({ action, styleUrl, initial, submitLabel }: PropertyFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [timezone, setTimezone] = useState("");
  const v = state.values;
  const location = v?.lat !== undefined && v.lng !== undefined ? { lat: v.lat, lng: v.lng } : initial?.location;
  useEffect(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  return (
    <form action={formAction} className="form">
      <label>
        Property name
        <input name="name" defaultValue={v?.name ?? initial?.name} minLength={2} maxLength={50} required />
      </label>
      <label className="check">
        <input type="checkbox" name="private" defaultChecked={v?.isPrivate ?? initial?.isPrivate} /> Private (hidden from the map and public lists)
      </label>
      <div>
        <span>Location on the Gaia map</span>
        <p className="muted" style={{ marginTop: 4 }}>
          Click to drop a pin, or drag it. Each property is a one-hectare parcel centred on the pin.
        </p>
        <LocationPicker styleUrl={styleUrl} value={location} inputNames={{ lat: "lat", lng: "lng" }} className="picker" />
      </div>
      <input type="hidden" name="timezone" value={timezone} />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
