"use client";

import React, { useEffect, useState } from "react";

interface InlineFieldInputProps {
  value: string | number | null | undefined;
  isNumeric?: boolean;
  step?: string;
  min?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  formatDisplay?: (val: string | number | null | undefined) => string;
  onCommit: (nextVal: string) => void;
}

export default function InlineFieldInput({
  value,
  isNumeric = false,
  step,
  min,
  placeholder,
  disabled = false,
  className = "",
  formatDisplay,
  onCommit,
}: InlineFieldInputProps) {
  const formatted = formatDisplay
    ? formatDisplay(value)
    : value === null || value === undefined
      ? ""
      : String(value);

  const disallowNegative = isNumeric && min !== undefined && Number(min) >= 0;

  const [draft, setDraft] = useState(formatted);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatted);
    }
  }, [formatted, isFocused]);

  return (
    <input
      type={isNumeric ? "number" : "text"}
      step={isNumeric ? step : undefined}
      min={isNumeric ? min : undefined}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => {
        const next = disallowNegative ? e.target.value.replace(/-/g, "") : e.target.value;
        setDraft(next);
      }}
      onBlur={() => {
        setIsFocused(false);
        let finalVal = draft;
        if (disallowNegative && finalVal.trim() !== "") {
          const num = Number(finalVal);
          if (Number.isNaN(num) || num < 0) {
            finalVal = "0";
            setDraft("0");
          }
        }
        if (finalVal !== formatted) {
          onCommit(finalVal);
        }
      }}
      onKeyDown={(e) => {
        if (disallowNegative && (e.key === "-" || e.key === "e" || e.key === "E")) {
          e.preventDefault();
          return;
        }
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(formatted);
          setIsFocused(false);
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
