"use client";

/**
 * FormNull — PhoneControl (Field System 2.0)
 * =====================================================================
 * The respondent-facing phone input shared by the builder canvas,
 * preview, and public form (one authoritative control — Part 13 of the
 * rebuild directive: no per-surface reimplementations).
 *
 * Structure: [country select with calling code] [national number input]
 *
 * The stored answer is ONE composed string — "+91 98765 43210" — which
 * is exactly the format migration 006's phone validation accepts
 * (^[+]?[0-9(). -]{5,25}$). Country selection changes the calling-code
 * prefix; the server contract is untouched. No per-country validation
 * claims are made beyond digit-count sanity (see validateFieldValue's
 * phone branch for the full client/server contract).
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COUNTRIES, countryByIso, detectCountryFromLocale, parsePhoneValue, composePhoneValue, type Country } from "./country-data";

const POPULAR = ["US", "GB", "IN", "CA", "AU", "DE"];

export function PhoneControl({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  defaultCountry,
}: {
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  placeholder?: string | null;
  /** config.defaultCountry — presentation-only initial selection. */
  defaultCountry?: unknown;
}) {
  // Mount-time resolution, in priority order (this control only mounts
  // client-side — the builder, preview, and public form all render it
  // after their data loads, so there is no SSR/hydration surface):
  //   existing value → configured default → browser locale → US.
  // "Auto detect" IS the browser-locale heuristic (no network, no
  // geolocation API — honest detection).
  const [initial] = useState(() => {
    const parsed =
      typeof value === "string" && value.trim() !== ""
        ? parsePhoneValue(value, undefined)
        : { country: undefined as Country | undefined, national: "" };
    const configured =
      typeof defaultCountry === "string" ? countryByIso(defaultCountry) : undefined;
    const country =
      parsed.country ?? configured ?? detectCountryFromLocale() ?? countryByIso("US");
    return { country, national: parsed.national };
  });

  const [country, setCountry] = useState<Country | undefined>(initial.country);
  const [national, setNational] = useState(initial.national);

  function emit(nextCountry: Country | undefined, nextNational: string) {
    setCountry(nextCountry);
    setNational(nextNational);
    onChange(composePhoneValue(nextCountry, nextNational));
  }

  const selectId = `${id}-country`;

  return (
    <div className="flex gap-2">
      <Select
        value={country?.iso ?? ""}
        onValueChange={(iso) => {
          const c = countryByIso(iso);
          emit(c, national);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={selectId}
          aria-label="Country calling code"
          className="h-10 w-[7.5rem] shrink-0"
        >
          <SelectValue placeholder="Code" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {COUNTRIES.map((c) => (
            <SelectItem
              key={c.iso}
              value={c.iso}
              className={POPULAR.includes(c.iso) ? "font-semibold" : undefined}
            >
              {c.iso} +{c.dial}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        className="h-10 min-w-0 flex-1"
        value={national}
        onChange={(e) => emit(country, e.target.value)}
        placeholder={placeholder ?? "98765 43210"}
        disabled={disabled}
        maxLength={25}
      />
    </div>
  );
}
