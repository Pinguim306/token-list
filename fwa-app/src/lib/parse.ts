import { parseUnits } from "viem";

export type Parsed = { value: bigint | null; error: string | null };

const OK: Parsed = { value: null, error: null };

/**
 * User input is free text, and both `BigInt()` and `parseUnits()` THROW on
 * anything unexpected. Called from a component body that is a crash: React
 * unmounts the whole tree, so a stray keystroke in one field can blank the
 * entire page. These helpers never throw — they return an error to render.
 */

/** Whole, non-negative integer (token ids, position ids, day numbers). */
export function parseInteger(input: string, label = "Value"): Parsed {
  const v = input.trim();
  if (v === "") return OK;
  if (!/^\d+$/.test(v)) {
    return { value: null, error: `${label} must be a whole number.` };
  }
  return { value: BigInt(v), error: null };
}

export type ParsedAddress = { value: `0x${string}` | null; error: string | null };

/** EVM address (0x + 40 hex chars). Same never-throw contract as the others. */
export function parseAddress(input: string, label = "Address"): ParsedAddress {
  const v = input.trim();
  if (v === "") return { value: null, error: null };
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    return { value: null, error: `${label} must be a 0x… address (40 hex characters).` };
  }
  return { value: v as `0x${string}`, error: null };
}

/** Decimal token amount, scaled by `decimals`. */
export function parseAmount(input: string, decimals: number, label = "Amount"): Parsed {
  const v = input.trim();
  if (v === "") return OK;
  if (!/^\d*\.?\d*$/.test(v) || v === ".") {
    return { value: null, error: `${label} must be a number.` };
  }
  const [, fraction = ""] = v.split(".");
  if (fraction.length > decimals) {
    return { value: null, error: `${label} has more than ${decimals} decimal places.` };
  }
  try {
    const value = parseUnits(v, decimals);
    if (value <= 0n) return { value: null, error: `${label} must be greater than zero.` };
    return { value, error: null };
  } catch {
    // Defensive: the regex above should have caught anything parseUnits rejects.
    return { value: null, error: `${label} is not a valid number.` };
  }
}
