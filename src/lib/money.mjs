const localeByCode = {
  fr: "fr-HT",
  ht: "ht-HT",
  en: "en-US",
};

const rateScale = 100_000_000n;
const inverseRateNumerator = rateScale * rateScale;

function parseFixed(value, decimalPlaces, label) {
  if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`${label} must be a decimal string.`);
  }

  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > decimalPlaces) {
    throw new RangeError(`${label} supports at most ${decimalPlaces} decimal places.`);
  }
  const scale = 10n ** BigInt(decimalPlaces);
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(decimalPlaces, "0") || "0");
  return negative ? -units : units;
}

function roundDivide(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError("The exchange rate must be greater than zero.");
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return numerator < 0n ? -rounded : rounded;
}

function minorUnitsToDecimal(minorUnits) {
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Invert a positive rate and round to the database's eight-decimal precision.
 * @param {string} rate
 * @returns {string}
 */
export function invertExchangeRate(rate) {
  const rateUnits = parseFixed(rate, 8, "Exchange rate");
  if (rateUnits <= 0n) throw new RangeError("The exchange rate must be greater than zero.");
  const inverseUnits = (inverseRateNumerator + rateUnits / 2n) / rateUnits;
  if (inverseUnits <= 0n) throw new RangeError("The inverse exchange rate is below supported precision.");
  const whole = inverseUnits / rateScale;
  const fraction = (inverseUnits % rateScale).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
}

/**
 * Convert an exact two-decimal amount using a rate expressed as HTG per USD.
 * Returns null when no rate has been entered and the currencies differ.
 * @param {string} amount
 * @param {"HTG" | "USD"} fromCurrency
 * @param {"HTG" | "USD"} toCurrency
 * @param {string | null} usdToHtgRate
 * @returns {string | null}
 */
export function convertMoney(amount, fromCurrency, toCurrency, usdToHtgRate) {
  const amountCents = parseFixed(amount, 2, "Amount");
  if (fromCurrency === toCurrency) return minorUnitsToDecimal(amountCents);
  if (usdToHtgRate === null) return null;

  const rate = parseFixed(usdToHtgRate, 8, "Exchange rate");
  if (rate <= 0n) throw new RangeError("The exchange rate must be greater than zero.");

  const convertedCents = fromCurrency === "USD"
    ? roundDivide(amountCents * rate, rateScale)
    : roundDivide(amountCents * rateScale, rate);
  return minorUnitsToDecimal(convertedCents);
}

/**
 * Format an exact decimal amount without converting it through a floating-point number.
 * @param {string} amount
 * @param {"HTG" | "USD"} currency
 * @param {"fr" | "ht" | "en"} locale
 * @returns {string}
 */
export function formatMoney(amount, currency, locale) {
  const cents = parseFixed(amount, 2, "Amount");
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  const anchor = negative ? (whole === 0n ? -0.01 : -whole) : whole;
  const formatter = new Intl.NumberFormat(localeByCode[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return formatter.formatToParts(anchor)
    .map((part) => part.type === "fraction" ? fraction : part.value)
    .join("");
}

/**
 * Format the HTG-per-USD rate with exact decimal digits and locale grouping.
 * @param {string} rate
 * @param {"fr" | "ht" | "en"} locale
 * @returns {string}
 */
export function formatExchangeRate(rate, locale) {
  const units = parseFixed(rate, 8, "Exchange rate");
  if (units <= 0n) throw new RangeError("The exchange rate must be greater than zero.");
  const whole = units / rateScale;
  const fraction = (units % rateScale).toString().padStart(8, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const visibleFraction = trimmedFraction.padEnd(2, "0");
  const formatter = new Intl.NumberFormat(localeByCode[locale], { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(localeByCode[locale], { minimumFractionDigits: 1 })
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? ".";
  return `${formatter.format(whole)}${decimal}${visibleFraction}`;
}
