import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import type { LngLat } from "@emerald-city/core";

export interface LocationPickerProps {
  styleUrl: string;
  /** Initial pin, if the property is already placed. */
  value?: LngLat | null;
  onChange?: (value: LngLat) => void;
  /** Renders hidden `lat` / `lng` inputs with these names, for plain HTML forms and server actions. */
  inputNames?: { lat: string; lng: string };
  className?: string;
}

/** Click (or drag the pin) to choose where a property drops onto the Gaia map. */
export function LocationPicker({ styleUrl, value, onChange, inputNames, className }: LocationPickerProps) {
  const el = useRef<HTMLDivElement>(null);
  const marker = useRef<Marker | null>(null);
  const [picked, setPicked] = useState<LngLat | null>(value ?? null);
  const change = useRef(onChange);
  change.current = onChange;
  const latInput = useRef<HTMLInputElement>(null);
  const lngInput = useRef<HTMLInputElement>(null);

  // Keep the hidden inputs in step with the pin, including after the form is reset
  // (React 19 resets forms after an action, which would otherwise clear them while the pin stays).
  useEffect(() => {
    const write = () => {
      if (latInput.current) latInput.current.value = picked ? String(picked.lat) : "";
      if (lngInput.current) lngInput.current.value = picked ? String(picked.lng) : "";
    };
    write();
    const form = latInput.current?.form;
    const onReset = () => setTimeout(write, 0);
    form?.addEventListener("reset", onReset);
    return () => form?.removeEventListener("reset", onReset);
  }, [picked]);

  useEffect(() => {
    if (!el.current) return;
    const m: MlMap = new maplibregl.Map({
      container: el.current,
      style: styleUrl,
      center: value ? [value.lng, value.lat] : [0, 20],
      zoom: value ? 15 : 1.5,
    });
    m.addControl(new maplibregl.NavigationControl(), "top-right");

    const place = (p: LngLat) => {
      const lngLat: [number, number] = [p.lng, p.lat];
      if (!marker.current) {
        marker.current = new maplibregl.Marker({ color: "#1fa37a", draggable: true }).setLngLat(lngLat).addTo(m);
        marker.current.on("dragend", () => {
          const ll = marker.current!.getLngLat();
          set({ lng: ll.lng, lat: ll.lat });
        });
      } else marker.current.setLngLat(lngLat);
    };
    const set = (p: LngLat) => {
      const clamped = { lng: ((((p.lng + 180) % 360) + 360) % 360) - 180, lat: Math.max(-85, Math.min(85, p.lat)) };
      setPicked(clamped);
      change.current?.(clamped);
    };

    if (value) place(value);
    m.on("click", (e) => {
      place({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      set({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    return () => {
      marker.current = null;
      m.remove();
    };
    // The map is created once per style; `value` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  return (
    <div className={className}>
      <div ref={el} style={{ width: "100%", height: "100%", minHeight: 320, borderRadius: 8, overflow: "hidden" }} />
      {inputNames && (
        <>
          <input ref={latInput} type="hidden" name={inputNames.lat} defaultValue={picked?.lat ?? ""} />
          <input ref={lngInput} type="hidden" name={inputNames.lng} defaultValue={picked?.lng ?? ""} />
        </>
      )}
    </div>
  );
}
